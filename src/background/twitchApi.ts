type ViewerListResult = {
  viewers: string[];
  totalAuthenticatedCount: number;
};

type UserInfo = {
  username: string;
  displayName: string | null;
  createdAt: string | null;
  description: string | null;
  profileImageURL: string | null;
};

const GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_HEADERS = {
  "Client-Id": "kd1unb4b3q4t58fwlpcbzcbnm76a8fp",
  "Content-Type": "application/json",
};

async function request<T>(body: unknown): Promise<T> {
  const response = await fetch(GQL_URL, {
    method: "POST",
    headers: TWITCH_HEADERS,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Twitch API request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getViewerCount(channelName: string): Promise<number> {
  const response = await request<{ data?: { user?: { stream?: { viewersCount?: number } } } }>({
    query: `query { user(login: "${channelName}") { stream { viewersCount } } }`,
  });

  return response.data?.user?.stream?.viewersCount ?? 0;
}

async function getViewerList(channelName: string): Promise<ViewerListResult> {
  const payload = [
    {
      operationName: "CommunityTab",
      variables: { login: channelName },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: "92168b4434c8f4d32df14510052131c3544b929723d5f8b69bb96c96207e483e",
        },
      },
    },
  ];

  const response = await request<Array<{ data?: { user?: { channel?: { chatters?: { count?: number; broadcasters?: Array<{ login: string }>; moderators?: Array<{ login: string }>; vips?: Array<{ login: string }>; viewers?: Array<{ login: string }>; chatbots?: Array<{ login: string }> } } } } }>>(payload);
  const data = response[0]?.data?.user?.channel?.chatters;
  const viewers = [
    ...(data?.broadcasters || []),
    ...(data?.moderators || []),
    ...(data?.vips || []),
    ...(data?.viewers || []),
    ...(data?.chatbots || []),
  ].map((viewer) => viewer.login);

  return {
    viewers,
    totalAuthenticatedCount: data?.count ?? 0,
  };
}

export async function getViewerListParallel(channelName: string, concurrentCalls = 12): Promise<ViewerListResult> {
  const results = await Promise.allSettled(Array.from({ length: concurrentCalls }, () => getViewerList(channelName)));
  const viewers = new Set<string>();
  let totalAuthenticatedCount = 0;

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }

    result.value.viewers.forEach((viewer) => viewers.add(viewer));
    totalAuthenticatedCount = Math.max(totalAuthenticatedCount, result.value.totalAuthenticatedCount);
  }

  return {
    viewers: Array.from(viewers),
    totalAuthenticatedCount,
  };
}

export async function getUserInfoGraphQL(usernames: string[]): Promise<UserInfo[]> {
  const batches: string[][] = [];
  for (let index = 0; index < usernames.length; index += 20) {
    batches.push(usernames.slice(index, index + 20));
  }

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const payload = batch.map((username) => ({
        operationName: "GetUserBasic",
        variables: { login: username },
        query: "query GetUserBasic($login: String!) { user(login: $login) { login displayName createdAt description profileImageURL(width: 300) } }",
      }));

      const response = await request<Array<{ data?: { user?: { login?: string; displayName?: string; createdAt?: string; description?: string | null; profileImageURL?: string | null } | null } }>>(payload);
      return batch.map((username, index) => {
        const user = response[index]?.data?.user;
        return {
          username,
          displayName: user?.displayName ?? null,
          createdAt: user?.createdAt ?? null,
          description: user?.description ?? null,
          profileImageURL: user?.profileImageURL ?? null,
        };
      });
    }),
  );

  return results.flatMap((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : batches[index].map((username) => ({
          username,
          displayName: null,
          createdAt: null,
          description: null,
          profileImageURL: null,
        })),
  );
}
