// Two observations per opted-in GitHub JSON source. They move with the collection success cursor.
export interface GithubRepoStars {
  id: number;
  repo: string;
  stars: number;
  createdAt: string;
}
interface Observation { at: string; repos: GithubRepoStars[] }
export interface GithubHistory { url: string; current: Observation; previous: Observation | null }

export function supportsGithubStars(url: unknown): boolean {
  if (typeof url !== "string" || !URL.canParse(url)) return false;
  const u = new URL(url);
  return u.origin === "https://api.github.com" && !u.username && !u.password
    && /^\/(?:search\/repositories|(?:users|orgs)\/[\w.-]+\/repos)\/?$/.test(u.pathname);
}

export function githubRepoStars(row: Record<string, unknown>, url: string): GithubRepoStars | null {
  const { id, full_name: repo, stargazers_count: stars, created_at: createdAt } = row;
  if (row.private !== false || typeof id !== "number" || !Number.isSafeInteger(id) || id < 1
    || typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split("/").some(s => s === "." || s === "..")
    || url !== `https://github.com/${repo}` || row.html_url !== url
    || typeof stars !== "number" || !Number.isSafeInteger(stars) || stars < 0
    || typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) return null;
  return { id, repo, stars, createdAt: new Date(createdAt).toISOString() };
}

export function observeGithubStars(prior: GithubHistory | undefined, url: string, repos: GithubRepoStars[], now: Date): GithubHistory {
  const at = now.toISOString();
  const before = prior?.url === url ? prior.current : null;
  if (before && at.slice(0, 10) === before.at.slice(0, 10)) return prior!;
  return { url, current: { at, repos }, previous: before };
}
