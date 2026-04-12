export interface SummaryStartRequest {
  action: "start"
  url: string
}

export interface SummaryPollRequest {
  action: "poll"
  jobId: string
}

export interface ProviderSummaryPollRequest {
  jobId: string
  url: string
  videoTitle?: string
}

export type SummaryRequest = SummaryStartRequest | SummaryPollRequest

export interface SummaryEssenceFrame {
  sheetUrl: string
  frameWidth: number
  frameHeight: number
  columns: number
  rows: number
  column: number
  row: number
  timestampMs: number
}

interface SummaryCreditsMeta {
  creditsRemaining?: number
}

export interface SummaryCompletedResponse extends SummaryCreditsMeta {
  status: "completed"
  summary: string
  videoTitle: string
  model: string
  transcriptLanguage?: string
  essenceFrame?: SummaryEssenceFrame
}

export interface SummaryProcessingResponse extends SummaryCreditsMeta {
  status: "processing"
  jobId: string
  videoTitle: string
}

export interface SummaryErrorResponse {
  status: "error"
  message: string
  creditsRemaining?: number
}

export type SummaryResponse = SummaryCompletedResponse | SummaryProcessingResponse | SummaryErrorResponse
