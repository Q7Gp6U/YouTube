export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          credits_balance: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          credits_balance?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          email?: string | null
          full_name?: string | null
          credits_balance?: number
          created_at?: string
          updated_at?: string
        }
      }
      credit_transactions: {
        Row: {
          id: string
          user_id: string
          summary_job_id: string | null
          amount: number
          transaction_type: string
          description: string | null
          created_at: string
          metadata: Json | null
        }
        Insert: {
          id?: string
          user_id: string
          summary_job_id?: string | null
          amount: number
          transaction_type: string
          description?: string | null
          created_at?: string
          metadata?: Json | null
        }
        Update: {
          summary_job_id?: string | null
          amount?: number
          transaction_type?: string
          description?: string | null
          metadata?: Json | null
        }
      }
      summary_jobs: {
        Row: {
          id: string
          user_id: string
          original_url: string
          normalized_url: string
          status: string
          provider_job_id: string | null
          video_title: string | null
          summary: string | null
          model: string | null
          transcript_language: string | null
          essence_frame: Json | null
          error_message: string | null
          internal_error_message: string | null
          provider_attempt_count: number
          next_provider_attempt_at: string | null
          credits_reserved: number
          refund_eligible: boolean
          refunded_at: string | null
          cost_committed_at: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          original_url: string
          normalized_url: string
          status?: string
          provider_job_id?: string | null
          video_title?: string | null
          summary?: string | null
          model?: string | null
          transcript_language?: string | null
          essence_frame?: Json | null
          error_message?: string | null
          internal_error_message?: string | null
          provider_attempt_count?: number
          next_provider_attempt_at?: string | null
          credits_reserved?: number
          refund_eligible?: boolean
          refunded_at?: string | null
          cost_committed_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          original_url?: string
          normalized_url?: string
          status?: string
          provider_job_id?: string | null
          video_title?: string | null
          summary?: string | null
          model?: string | null
          transcript_language?: string | null
          essence_frame?: Json | null
          error_message?: string | null
          internal_error_message?: string | null
          provider_attempt_count?: number
          next_provider_attempt_at?: string | null
          credits_reserved?: number
          refund_eligible?: boolean
          refunded_at?: string | null
          cost_committed_at?: string | null
          completed_at?: string | null
          updated_at?: string
        }
      }
      summary_rate_limits: {
        Row: {
          user_id: string
          action: string
          window_started_at: string
          request_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          action: string
          window_started_at: string
          request_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          request_count?: number
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_summary_job: {
        Args: {
          p_original_url: string
          p_normalized_url: string
        }
        Returns: {
          job_id: string
          job_status: string
          provider_job_id: string | null
          video_title: string | null
          credits_remaining: number
          was_created: boolean
        }[]
      }
      mark_summary_job_processing: {
        Args: {
          p_job_id: string
          p_provider_job_id: string
          p_video_title?: string | null
        }
        Returns: {
          job_id: string
          status: string
          video_title: string | null
        }[]
      }
      complete_summary_job: {
        Args: {
          p_job_id: string
          p_video_title: string
          p_summary: string
          p_model: string
          p_transcript_language?: string | null
          p_essence_frame?: Json | null
        }
        Returns: {
          job_id: string
          status: string
          credits_remaining: number
        }[]
      }
      fail_summary_job: {
        Args: {
          p_job_id: string
          p_public_error_message: string
          p_refund_credit?: boolean
          p_internal_error_message?: string | null
        }
        Returns: {
          job_id: string
          status: string
          credits_remaining: number
          refunded: boolean
        }[]
      }
      schedule_summary_job_retry: {
        Args: {
          p_job_id: string
          p_next_provider_attempt_at: string
          p_public_error_message?: string | null
          p_internal_error_message?: string | null
        }
        Returns: {
          job_id: string
          status: string
          next_provider_attempt_at: string | null
          provider_attempt_count: number
        }[]
      }
      consume_summary_rate_limit: {
        Args: {
          p_action: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
          remaining: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
