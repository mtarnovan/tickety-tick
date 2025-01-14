/**
 * Jira adapter
 *
 * The adapter extracts the identifier of the selected issue from the page URL
 * and uses the Jira API to retrieve the corresponding ticket information.
 *
 * https://developer.atlassian.com/server/jira/platform/rest-apis/
 *
 * Supported page URLs:
 * - Backlog and Active Sprints: https://<YOUR-SUBDOMAIN>.atlassian.net/secure/RapidBoard.jspa?…&selectedIssue=<ISSUE-KEY>
 * - Issues and filters: https://<YOUR-SUBDOMAIN>.atlassian.net/projects/<PROJECT-KEY>/issues/<ISSUE-KEY>
 * - Issue view: https://<YOUR-SUBDOMAIN>.atlassian.net/browse/<ISSUE-KEY>
 */

import { fromADF } from "mdast-util-from-adf";
import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { match } from "micro-match";

import client from "../client";
import type { TicketData } from "../types";

type JiraTicketInfo = {
  key: string;
  fields: {
    issuetype: { name: string };
    summary: string;
    description: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
};

function isJiraPage(url: URL, document: Document) {
  if (url.host.endsWith(".atlassian.net")) return true;
  if (document.body.id === "jira") return true; // self-managed instance on different domain
  return false;
}

const pathSuffixes = new RegExp(
  "/(jira/software/([^/]/)?)?(browse/[^/]+|projects/[^/]+/issues/[^/]+|projects/[^/]+/boards/.*|secure/RapidBoard.jspa)$",
  "g"
);

function getPathPrefix(url: URL) {
  return url.pathname.replace(pathSuffixes, "");
}

function getSelectedIssueId(url: URL, prefix = "") {
  const { searchParams: params } = new URL(url.href);

  if (params.has("selectedIssue")) return params.get("selectedIssue");

  const path = url.pathname
    .substr(prefix.length)
    .replace(/^\/jira\/software/, ""); // strip path prefix

  return ["/projects/:project/issues/:id", "/browse/:id"]
    .map((pattern) => match(pattern, path).id)
    .find(Boolean);
}

function extractTicketInfo(info: JiraTicketInfo, host: string) {
  const { key: id, fields } = info;
  const { issuetype, summary: title } = fields;

  const type = issuetype.name.toLowerCase();
  const url = `https://${host}/browse/${id}`;
  const description = fields.description
    ? toMarkdown(fromADF(fields.description), { extensions: [gfmToMarkdown()] })
    : undefined;

  return {
    type,
    id,
    title,
    description,
    url,
  };
}

async function scan(url: URL, document: Document): Promise<TicketData[]> {
  if (!isJiraPage(url, document)) return [];

  const prefix = getPathPrefix(url); // self-managed instances may host on a subpath

  const id = getSelectedIssueId(url, prefix);

  if (!id) return [];

  const jira = client(`https://${url.host}${prefix}/rest/api/3`);
  const response = await jira.get(`issue/${id}`).json<JiraTicketInfo>();
  const ticket = extractTicketInfo(response, url.host);

  return [ticket];
}

export default scan;
