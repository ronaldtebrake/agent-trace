export * from "./schemas.js";
export type { ContributorType } from "./schemas.js";

export interface FileEdit {
  old_string: string;
  new_string: string;
  range?: {
    start_line_number: number;
    end_line_number: number;
    start_column: number;
    end_column: number;
  };
}

export interface RangePosition {
  start_line: number;
  end_line: number;
}
