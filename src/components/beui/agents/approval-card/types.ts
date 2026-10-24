import type { ReactNode } from "react";

export type ApprovalCardStatus =
  | "pending"
  | "submitting"
  | "approved"
  | "rejected"
  | "changes-requested"
  | "answered"
  | "skipped";

export interface ApprovalCardOption {
  value: string;
  label: string;
  /** Plain supporting text rendered under the label. */
  description?: string;
  disabled?: boolean;
}

export interface ApprovalCardQuestion {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  options?: ApprovalCardOption[];
  multiple?: boolean;
  /** Adds a free-text entry after the options. Questions without options always get one. */
  allowCustom?: boolean;
  customPlaceholder?: string;
}

export interface ApprovalCardAnswer {
  selected: string[];
  custom?: string;
}

export type ApprovalCardAnswers = Record<string, ApprovalCardAnswer>;

/** Built-in strings; callers pass localized text. */
export interface ApprovalCardLabels {
  status: Record<ApprovalCardStatus, string>;
  dismiss: string;
  previousQuestion: string;
  nextQuestion: string;
  customOption: string;
  customPlaceholder: string;
}

export interface ApprovalCardProps {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  questions?: ApprovalCardQuestion[];
  status?: ApprovalCardStatus;
  answers?: ApprovalCardAnswers;
  defaultAnswers?: ApprovalCardAnswers;
  onAnswersChange?: (answers: ApprovalCardAnswers) => void;
  step?: number;
  defaultStep?: number;
  onStepChange?: (step: number) => void;
  onSubmit?: (answers: ApprovalCardAnswers) => void;
  onApprove?: () => void;
  onReject?: () => void;
  onRequestChanges?: () => void;
  onDismiss?: () => void;
  approveLabel?: ReactNode;
  submitLabel?: ReactNode;
  labels?: Partial<ApprovalCardLabels>;
  result?: ReactNode;
  className?: string;
}
