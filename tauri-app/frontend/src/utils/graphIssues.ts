/// Mapping diagnostics backend → classes sur les nodes React Flow.
/// `node_ids` portent les clés frontend (__fe_id) émises par `diagnose`.
import type { GraphIssue } from '../types/generated/GraphIssue';
import type { IssueSeverity } from '../types/generated/IssueSeverity';
export type { GraphIssue };

export interface NodeIssue {
  severity: IssueSeverity;
  messages: string[];
}

/// Agrège les issues par node — un node peut cumuler erreur + warning
/// (l'erreur l'emporte pour la classe).
export function issuesByNode(issues: GraphIssue[]): Map<string, NodeIssue> {
  const map = new Map<string, NodeIssue>();
  for (const issue of issues) {
    for (const id of issue.node_ids) {
      const cur = map.get(id);
      if (!cur) {
        map.set(id, { severity: issue.severity, messages: [issue.message] });
      } else {
        cur.messages.push(issue.message);
        if (issue.severity === 'Error') cur.severity = 'Error';
      }
    }
  }
  return map;
}

/// Classe CSS à appliquer à un node — null si aucune issue.
export function nodeIssueClass(map: Map<string, NodeIssue>, nodeId: string): string | null {
  const issue = map.get(nodeId);
  if (!issue) return null;
  return issue.severity === 'Error' ? 'rf-node-error' : 'rf-node-warning';
}

export interface IssueCounts {
  errors: number;
  warnings: number;
}

export function countIssues(issues: GraphIssue[]): IssueCounts {
  let errors = 0;
  let warnings = 0;
  for (const i of issues) {
    if (i.severity === 'Error') errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}
