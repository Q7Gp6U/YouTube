export interface SummaryStartRequest {
  action: "start"
  url: string
}

export interface SummaryPollRequest {
  action: "poll"
  url: string
  jobId: string
  videoTitle?: string
}

export type SummaryRequest = SummaryStartRequest | SummaryPollRequest

export interface SummaryCompletedResponse {
  status: "completed"
  summary: string
  videoTitle: string
  model: string
  transcriptLanguage?: string
}

export interface SummaryProcessingResponse {
  status: "processing"
  jobId: string
  videoTitle: string
}

export interface SummaryErrorResponse {
  status: "error"
  message: string
}

export type SummaryResponse =
  | SummaryCompletedResponse
  | SummaryProcessingResponse
  | SummaryErrorResponse
