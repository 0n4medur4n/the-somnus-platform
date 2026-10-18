import type { AdminCapability } from "@somnus/api-contracts";
import { useQuery } from "@tanstack/react-query";
import type { IconName } from "../components/ui/Icon.js";
import { edge } from "../lib/edge.js";

export type ViewId =
  | "overview"
  | "users"
  | "verification"
  | "deletions"
  | "roles"
  | "organizations"
  | "contentReview"
  | "corpus"
  | "corpusSources"
  | "statistics"
  | "audit"
  | "breakGlass"
  | "drive";

export type SectionDef = {
  id: Exclude<ViewId, "overview">;
  icon: IconName;
  capability: AdminCapability;
};

/**
 * Which capability each section needs (Addendum A §A2.2 / Addendum B / ADR
 * 0019), grouped as the sidebar shows them. This table is the ONLY thing that
 * decides whether a section is offered -- the console has no role logic of its
 * own, and `capabilities` is a decision identity made. A section that is not
 * offered has no URL either: the server would refuse the call anyway, and not
 * rendering the control means an admin is never invited into a 403.
 */
export const GROUPS: Array<{ key: string; sections: SectionDef[] }> = [
  {
    key: "people",
    sections: [
      { id: "users", icon: "users", capability: "admin_users_read" },
      { id: "verification", icon: "verify", capability: "admin_verification_queue" },
      { id: "deletions", icon: "userX", capability: "admin_deletion_requests_process" },
      { id: "roles", icon: "key", capability: "admin_roles_assign" },
    ],
  },
  {
    key: "organizations",
    sections: [{ id: "organizations", icon: "building", capability: "admin_organizations_manage" }],
  },
  {
    key: "content",
    sections: [
      // §A2.2: clinical_governance_reviewer and platform_super_admin only.
      { id: "contentReview", icon: "sparkles", capability: "admin_content_review" },
      // Addendum B §B6 item 4: the reference corpus is platform_super_admin's alone.
      { id: "corpus", icon: "book", capability: "admin_corpus_manage" },
      { id: "corpusSources", icon: "library", capability: "admin_corpus_manage" },
    ],
  },
  {
    key: "security",
    sections: [
      { id: "statistics", icon: "chart", capability: "admin_statistics_read" },
      { id: "audit", icon: "scroll", capability: "admin_audit_read" },
      // §A2.2: support_agent and professional_verifier are not on this row, so
      // for them the section is structurally absent rather than disabled.
      { id: "breakGlass", icon: "siren", capability: "admin_break_glass" },
    ],
  },
  {
    key: "team",
    // ADR 0019: every internal role. Folder membership and keys decide the rest.
    sections: [{ id: "drive", icon: "drive", capability: "admin_drive" }],
  },
];

/** The sections a set of capabilities opens, in sidebar order, overview first. */
export function availableViews(capabilities: ReadonlyArray<AdminCapability>): ViewId[] {
  const held = new Set(capabilities);
  return [
    "overview",
    ...GROUPS.flatMap((g) => g.sections.filter((s) => held.has(s.capability)).map((s) => s.id)),
  ];
}

/** Pending work per queue, for the sidebar badges and the dashboard. Shared query keys. */
export function usePendingCounts(held: ReadonlySet<AdminCapability>) {
  const deletions = useQuery({
    queryKey: ["pending", "deletions"],
    queryFn: () => edge.deletionRequests(),
    enabled: held.has("admin_deletion_requests_process"),
  });
  const verification = useQuery({
    queryKey: ["pending", "verification"],
    queryFn: () => edge.verificationQueue(),
    enabled: held.has("admin_verification_queue"),
  });
  const contentReview = useQuery({
    queryKey: ["pending", "contentReview"],
    queryFn: () => edge.contentReviewQueue(),
    enabled: held.has("admin_content_review"),
  });
  return {
    deletions: deletions.data?.length,
    verification: verification.data?.length,
    contentReview: contentReview.data?.items.length,
  };
}
