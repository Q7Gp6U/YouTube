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
          credits_reserved: number
          refunded_at: string | null
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
          credits_reserved?: number
          refunded_at?: string | null
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
          credits_reserved?: number
          refunded_at?: string | null
          completed_at?: string | null
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
          p_error_message: string
          p_refund_credit?: boolean
        }
        Returns: {
          job_id: string
          status: string
          credits_remaining: number
          refunded: boolean
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
