import type { PageKey } from "@/lib/facebook";

const BUFFER_GRAPHQL_URL = "https://api.buffer.com/graphql";

export type BufferChannel = {
  id: string;
  name: string;
  service: string;
  type: string;
  isDisconnected: boolean;
};

export type BufferChannelMapping = {
  status: "missing-channel-id" | "id-not-found" | "not-a-facebook-page" | "disconnected" | "ready";
  channelName?: string;
};

export function checkBufferChannelMapping(channelId: string | undefined, channels: BufferChannel[]): BufferChannelMapping {
  if (!channelId) return { status: "missing-channel-id" };
  const channel = channels.find((candidate) => candidate.id === channelId);
  if (!channel) return { status: "id-not-found" };
  if (channel.service.toLowerCase() !== "facebook" || channel.type.toLowerCase() !== "page") {
    return { status: "not-a-facebook-page", channelName: channel.name };
  }
  if (channel.isDisconnected) return { status: "disconnected", channelName: channel.name };
  return { status: "ready", channelName: channel.name };
}

type GraphQLError = { message?: string };
type BufferGraphResponse<T> = { data?: T; errors?: GraphQLError[] };

export class BufferEnqueueOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BufferEnqueueOutcomeUnknownError";
  }
}

type BufferPostResponse = {
  createPost?: {
    __typename?: string;
    post?: { id?: string; status?: string; shareMode?: string; dueAt?: string | null };
    message?: string;
  };
};

export type BufferEnqueueResult = { postId: string; mediaFormat: "single" | "carousel" };

class BufferAssetsRejectedError extends Error {}

export function getBufferConfigurationGaps(pageKeys: PageKey[] = ["news", "entertainment"]): string[] {
  const missing: string[] = [];
  if (!process.env.BUFFER_API_KEY?.trim()) missing.push("BUFFER_API_KEY");
  for (const pageKey of pageKeys) {
    const variable = pageKey === "news" ? "BUFFER_NEWS_CHANNEL_ID" : "BUFFER_ENTERTAINMENT_CHANNEL_ID";
    if (!process.env[variable]?.trim()) missing.push(variable);
  }
  return missing;
}

function getApiKey() {
  const apiKey = process.env.BUFFER_API_KEY?.trim();
  if (!apiKey) throw new Error("BUFFER_API_KEY belum diatur di environment Vercel.");
  return apiKey;
}

function getChannelId(pageKey: PageKey) {
  const variable = pageKey === "news" ? "BUFFER_NEWS_CHANNEL_ID" : "BUFFER_ENTERTAINMENT_CHANNEL_ID";
  const channelId = process.env[variable]?.trim();
  if (!channelId) throw new Error(`${variable} belum diatur di environment Vercel.`);
  return channelId;
}

function safeMessage(message: string, apiKey: string) {
  return message.split(apiKey).join("[REDACTED]").slice(0, 300);
}

async function graphQL<T>(query: string, variables?: Record<string, unknown>, mutationMayHaveSideEffects = false): Promise<T> {
  const apiKey = getApiKey();
  let response: Response;
  try {
    response = await fetch(BUFFER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request ke Buffer gagal.";
    const safe = safeMessage(message, apiKey);
    if (mutationMayHaveSideEffects) {
      throw new BufferEnqueueOutcomeUnknownError(`Buffer API: hasil enqueue tidak diketahui setelah kegagalan jaringan (${safe}). Jangan kirim ulang sebelum memeriksa antrean Buffer.`);
    }
    throw new Error(`Buffer API: ${safe}`);
  }

  const result = await response.json().catch(() => null) as BufferGraphResponse<T> | null;
  if (!response.ok || result?.errors?.length) {
    const message = result?.errors?.map((item) => item.message).filter(Boolean).join("; ") || `HTTP ${response.status}`;
    const safe = safeMessage(message, apiKey);
    if (mutationMayHaveSideEffects && (response.status >= 500 || result?.errors?.length)) {
      throw new BufferEnqueueOutcomeUnknownError(`Buffer API: hasil enqueue tidak diketahui (${safe}). Jangan kirim ulang sebelum memeriksa antrean Buffer.`);
    }
    throw new Error(`Buffer API: ${safe}`);
  }
  if (!result?.data) {
    if (mutationMayHaveSideEffects) {
      throw new BufferEnqueueOutcomeUnknownError("Buffer API tidak mengembalikan data post setelah permintaan enqueue; periksa antrean Buffer sebelum mencoba lagi.");
    }
    throw new Error("Buffer API tidak mengembalikan data.");
  }
  return result.data;
}

export async function listBufferChannels(): Promise<BufferChannel[]> {
  const organizationsQuery = `query BufferOrganizations {
    account { organizations { id name } }
  }`;
  const organizationsData = await graphQL<{
    account?: { organizations?: Array<{ id: string; name: string }> };
  }>(organizationsQuery);
  const organizations = organizationsData.account?.organizations ?? [];
  if (!organizations.length) throw new Error("Tidak ada organisasi Buffer yang dapat diakses API key ini.");

  const channelsQuery = `query BufferChannels($input: ChannelsInput!) {
    channels(input: $input) {
      id
      name
      service
      type
      isDisconnected
    }
  }`;
  const results = await Promise.all(organizations.map(async (organization) => {
    const data = await graphQL<{ channels?: BufferChannel[] }>(channelsQuery, {
      input: { organizationId: organization.id, filter: { isLocked: false } },
    });
    return (data.channels ?? []).map((channel) => ({ ...channel, name: `${organization.name} — ${channel.name}` }));
  }));
  return results.flat();
}

export async function enqueueBufferFacebookPost(input: {
  pageKey: PageKey;
  imageUrl: string;
  imageUrls?: string[];
  caption: string;
}): Promise<BufferEnqueueResult> {
  const mutation = `mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess { __typename post { id status shareMode dueAt } }
      ... on InvalidInputError { __typename message }
      ... on UnauthorizedError { __typename message }
      ... on UnexpectedError { __typename message }
      ... on NotFoundError { __typename message }
      ... on LimitReachedError { __typename message }
      ... on RestProxyError { __typename message code }
    }
  }`;
  const requestedUrls = input.imageUrls?.length ? input.imageUrls : [input.imageUrl];
  const submit = async (imageUrls: string[]): Promise<string> => {
    const data = await graphQL<BufferPostResponse>(mutation, {
      input: {
        channelId: getChannelId(input.pageKey),
        mode: "addToQueue",
        schedulingType: "automatic",
        text: input.caption,
        assets: imageUrls.map((url) => ({ image: { url } })),
        metadata: { facebook: { type: "post" } },
      },
    }, true);
    const result = data.createPost;
    if (result?.message) {
      const message = safeMessage(result.message, getApiKey());
      if (imageUrls.length > 1 && result.__typename === "InvalidInputError" && /asset|image|media|multiple|carousel/i.test(message)) {
        throw new BufferAssetsRejectedError(message);
      }
      throw new Error(`Buffer API: ${message}`);
    }
    const postId = result?.post?.id;
    if (!postId) {
      throw new BufferEnqueueOutcomeUnknownError("Buffer tidak mengembalikan ID post setelah enqueue; periksa antrean Buffer sebelum mencoba lagi.");
    }
    return postId;
  };

  try {
    const postId = await submit(requestedUrls);
    return { postId, mediaFormat: requestedUrls.length > 1 ? "carousel" : "single" };
  } catch (error) {
    if (!(error instanceof BufferAssetsRejectedError)) throw error;
    console.warn(`[buffer] carousel ditolak untuk channel ${input.pageKey}; mencoba fallback satu gambar: ${safeMessage(error.message, getApiKey())}`);
    const postId = await submit([input.imageUrl]);
    return { postId, mediaFormat: "single" };
  }
}
