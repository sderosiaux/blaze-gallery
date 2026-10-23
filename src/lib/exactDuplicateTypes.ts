export type DuplicateKind = "files" | "folders";

export interface DuplicateMember {
  id: number;
  name: string;
  path: string;
  outside_gallery: boolean;
}

export interface ExactDuplicateGroup {
  key: string;
  count: number;
  files_per_member: number;
  bytes_per_member: number;
  extra_files: number;
  extra_bytes: number;
  /** Proposed keeper first, all locations included. */
  members: DuplicateMember[];
}

export interface DuplicateCursor {
  bytes: number;
  key: string;
}

export interface ExactDuplicatesPage {
  summary: {
    groups: number;
    members: number;
    extra_files: number;
    extra_bytes: number;
  };
  groups: ExactDuplicateGroup[];
  next: DuplicateCursor | null;
}

export interface DuplicateSelection {
  kind: DuplicateKind;
  group: string;
  /** Chosen photo ids for files; chosen folder ids for folders. */
  keep: number[];
  skip: string[];
}

export interface DuplicatePreview {
  count: number;
  bytes: number;
  groups: number;
  signature: string;
}
