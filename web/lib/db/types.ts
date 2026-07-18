export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          actor_external_id: string | null
          actor_user_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          event_type: string
          id: string
          metadata: Json | null
          persona_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_external_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          event_type: string
          id?: string
          metadata?: Json | null
          persona_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_external_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          persona_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_sessions: {
        Row: {
          channel: string
          created_at: string
          current_campaign_id: string | null
          external_user_id: string
          id: string
          last_active_at: string
          state: string
          state_data: Json | null
          workspace_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          current_campaign_id?: string | null
          external_user_id: string
          id?: string
          last_active_at?: string
          state?: string
          state_data?: Json | null
          workspace_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          current_campaign_id?: string | null
          external_user_id?: string
          id?: string
          last_active_at?: string
          state?: string
          state_data?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_sessions_current_campaign_id_fkey"
            columns: ["current_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_configs: {
        Row: {
          brand_name: string
          created_at: string
          current_prompt_version_id: string | null
          custom_system_prompt: string | null
          industry: string | null
          persona_id: string
          tone_tags: string[]
          updated_at: string
          voice_profile: Json | null
          voice_profile_updated_at: string | null
          website_url: string | null
          workspace_id: string
        }
        Insert: {
          brand_name: string
          created_at?: string
          current_prompt_version_id?: string | null
          custom_system_prompt?: string | null
          industry?: string | null
          persona_id: string
          tone_tags?: string[]
          updated_at?: string
          voice_profile?: Json | null
          voice_profile_updated_at?: string | null
          website_url?: string | null
          workspace_id: string
        }
        Update: {
          brand_name?: string
          created_at?: string
          current_prompt_version_id?: string | null
          custom_system_prompt?: string | null
          industry?: string | null
          persona_id?: string
          tone_tags?: string[]
          updated_at?: string
          voice_profile?: Json | null
          voice_profile_updated_at?: string | null
          website_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_configs_current_prompt_version_id_fkey"
            columns: ["current_prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_configs_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: true
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_persona_variants: {
        Row: {
          campaign_persona_id: string
          created_at: string
          id: string
          platform: string
          post_variant_id: string
          prompt_version_id: string | null
        }
        Insert: {
          campaign_persona_id: string
          created_at?: string
          id?: string
          platform: string
          post_variant_id: string
          prompt_version_id?: string | null
        }
        Update: {
          campaign_persona_id?: string
          created_at?: string
          id?: string
          platform?: string
          post_variant_id?: string
          prompt_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_persona_variants_campaign_persona_id_fkey"
            columns: ["campaign_persona_id"]
            isOneToOne: false
            referencedRelation: "campaign_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_persona_variants_post_variant_id_fkey"
            columns: ["post_variant_id"]
            isOneToOne: false
            referencedRelation: "post_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_persona_variants_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_personas: {
        Row: {
          approval_status: string
          approved_at: string | null
          campaign_id: string
          created_at: string
          generation_error: string | null
          id: string
          persona_id: string
          updated_at: string
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          campaign_id: string
          created_at?: string
          generation_error?: string | null
          id?: string
          persona_id: string
          updated_at?: string
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          campaign_id?: string
          created_at?: string
          generation_error?: string | null
          id?: string
          persona_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_personas_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_personas_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          brief: Json | null
          created_at: string
          failure_code: string | null
          failure_reason: string | null
          generation_started_at: string | null
          id: string
          ingestion_job_id: string
          kind: string
          status: string
          title: string | null
          updated_at: string
          user_angle: string | null
          window_end: string | null
          window_start: string | null
          workspace_id: string
        }
        Insert: {
          brief?: Json | null
          created_at?: string
          failure_code?: string | null
          failure_reason?: string | null
          generation_started_at?: string | null
          id?: string
          ingestion_job_id: string
          kind?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_angle?: string | null
          window_end?: string | null
          window_start?: string | null
          workspace_id: string
        }
        Update: {
          brief?: Json | null
          created_at?: string
          failure_code?: string | null
          failure_reason?: string | null
          generation_started_at?: string | null
          id?: string
          ingestion_job_id?: string
          kind?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_angle?: string | null
          window_end?: string | null
          window_start?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_ingestion_job_id_fkey"
            columns: ["ingestion_job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_cadences: {
        Row: {
          active: boolean
          autopilot_enabled: boolean
          created_at: string
          id: string
          last_low_nudge_at: string | null
          low_reservoir_threshold: number
          persona_id: string
          platform: string
          posts_per_week: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          autopilot_enabled?: boolean
          created_at?: string
          id?: string
          last_low_nudge_at?: string | null
          low_reservoir_threshold?: number
          persona_id: string
          platform: string
          posts_per_week?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          autopilot_enabled?: boolean
          created_at?: string
          id?: string
          last_low_nudge_at?: string | null
          low_reservoir_threshold?: number
          persona_id?: string
          platform?: string
          posts_per_week?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_cadences_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_cadences_platform_platform_fkey"
            columns: ["platform"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "content_cadences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_ideas: {
        Row: {
          created_at: string
          essence: string
          id: string
          idea_type: string
          ingestion_job_id: string
          source_quote: string
          strength: number
          suitable_angles: Json
          suitable_formats: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          essence: string
          id?: string
          idea_type: string
          ingestion_job_id: string
          source_quote: string
          strength?: number
          suitable_angles?: Json
          suitable_formats?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          essence?: string
          id?: string
          idea_type?: string
          ingestion_job_id?: string
          source_quote?: string
          strength?: number
          suitable_angles?: Json
          suitable_formats?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_ideas_ingestion_job_id_fkey"
            columns: ["ingestion_job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_ideas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          angle: string | null
          created_at: string
          format: string | null
          id: string
          idea_id: string | null
          ingestion_job_id: string | null
          matrix_cell_hash: string | null
          persona_id: string | null
          platform: string | null
          prompt_version_id: string | null
          status: string | null
          summary: string | null
          workspace_id: string
        }
        Insert: {
          angle?: string | null
          created_at?: string
          format?: string | null
          id?: string
          idea_id?: string | null
          ingestion_job_id?: string | null
          matrix_cell_hash?: string | null
          persona_id?: string | null
          platform?: string | null
          prompt_version_id?: string | null
          status?: string | null
          summary?: string | null
          workspace_id: string
        }
        Update: {
          angle?: string | null
          created_at?: string
          format?: string | null
          id?: string
          idea_id?: string | null
          ingestion_job_id?: string | null
          matrix_cell_hash?: string | null
          persona_id?: string | null
          platform?: string | null
          prompt_version_id?: string | null
          status?: string | null
          summary?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_items_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_ingestion_job_id_fkey"
            columns: ["ingestion_job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_platform_platform_fkey"
            columns: ["platform"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "content_items_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      error_events: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json
          origin: string | null
          source: string
          stack: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          origin?: string | null
          source: string
          stack?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          origin?: string | null
          source?: string
          stack?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          extracted_text: string | null
          extracted_title: string | null
          id: string
          source_text: string | null
          source_type: string
          source_url: string | null
          stage: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          extracted_text?: string | null
          extracted_title?: string | null
          id?: string
          source_text?: string | null
          source_type: string
          source_url?: string | null
          stage?: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          extracted_text?: string | null
          extracted_title?: string | null
          id?: string
          source_text?: string | null
          source_type?: string
          source_url?: string | null
          stage?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          bytes: number | null
          cloudinary_id: string
          cloudinary_url: string
          created_at: string
          format: string | null
          height: number | null
          id: string
          ingestion_job_id: string | null
          resource_type: string
          width: number | null
          workspace_id: string
        }
        Insert: {
          bytes?: number | null
          cloudinary_id: string
          cloudinary_url: string
          created_at?: string
          format?: string | null
          height?: number | null
          id?: string
          ingestion_job_id?: string | null
          resource_type: string
          width?: number | null
          workspace_id: string
        }
        Update: {
          bytes?: number | null
          cloudinary_id?: string
          cloudinary_url?: string
          created_at?: string
          format?: string | null
          height?: number | null
          id?: string
          ingestion_job_id?: string | null
          resource_type?: string
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_ingestion_job_id_fkey"
            columns: ["ingestion_job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_rate_limits: {
        Row: {
          day_reset_at: string
          id: string
          last_post_at: string | null
          persona_id: string
          platform: string
          posts_today: number
          updated_at: string
        }
        Insert: {
          day_reset_at?: string
          id?: string
          last_post_at?: string | null
          persona_id: string
          platform: string
          posts_today?: number
          updated_at?: string
        }
        Update: {
          day_reset_at?: string
          id?: string
          last_post_at?: string | null
          persona_id?: string
          platform?: string
          posts_today?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "persona_rate_limits_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          kind: string
          persona_id: string | null
          read_at: string | null
          title: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          kind: string
          persona_id?: string | null
          read_at?: string | null
          title: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          kind?: string
          persona_id?: string | null
          read_at?: string | null
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          avatar_color: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          slug: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          avatar_color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          slug: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          avatar_color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          slug?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_limits: {
        Row: {
          daily_post_limit: number
          platform: string
          updated_at: string
        }
        Insert: {
          daily_post_limit: number
          platform: string
          updated_at?: string
        }
        Update: {
          daily_post_limit?: number
          platform?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_limits_platform_fkey"
            columns: ["platform"]
            isOneToOne: true
            referencedRelation: "platforms"
            referencedColumns: ["slug"]
          },
        ]
      }
      platforms: {
        Row: {
          created_at: string
          display_name: string
          is_active: boolean
          slug: string
        }
        Insert: {
          created_at?: string
          display_name: string
          is_active?: boolean
          slug: string
        }
        Update: {
          created_at?: string
          display_name?: string
          is_active?: boolean
          slug?: string
        }
        Relationships: []
      }
      post_metrics: {
        Row: {
          comments: number | null
          id: string
          impressions: number | null
          last_synced_at: string
          likes: number | null
          post_variant_id: string
          shares: number | null
          workspace_id: string
        }
        Insert: {
          comments?: number | null
          id?: string
          impressions?: number | null
          last_synced_at?: string
          likes?: number | null
          post_variant_id: string
          shares?: number | null
          workspace_id: string
        }
        Update: {
          comments?: number | null
          id?: string
          impressions?: number | null
          last_synced_at?: string
          likes?: number | null
          post_variant_id?: string
          shares?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_metrics_post_variant_id_fkey"
            columns: ["post_variant_id"]
            isOneToOne: true
            referencedRelation: "post_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_metrics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      post_variant_media: {
        Row: {
          media_asset_id: string
          position: number
          post_variant_id: string
        }
        Insert: {
          media_asset_id: string
          position?: number
          post_variant_id: string
        }
        Update: {
          media_asset_id?: string
          position?: number
          post_variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_variant_media_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_variant_media_post_variant_id_fkey"
            columns: ["post_variant_id"]
            isOneToOne: false
            referencedRelation: "post_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_variant_revisions: {
        Row: {
          body: string
          created_at: string
          id: string
          instruction: string | null
          post_variant_id: string
          revision_number: number
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          instruction?: string | null
          post_variant_id: string
          revision_number: number
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          instruction?: string | null
          post_variant_id?: string
          revision_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_variant_revisions_post_variant_id_fkey"
            columns: ["post_variant_id"]
            isOneToOne: false
            referencedRelation: "post_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_variant_revisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      post_variants: {
        Row: {
          body: string
          claimed_at: string | null
          content_item_id: string
          created_at: string
          error: string | null
          error_code: string | null
          id: string
          next_retry_at: string | null
          persona_id: string | null
          platform: string
          platform_post_id: string | null
          platform_post_url: string | null
          prompt_version_id: string | null
          published_at: string | null
          retry_count: number | null
          scheduled_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          body: string
          claimed_at?: string | null
          content_item_id: string
          created_at?: string
          error?: string | null
          error_code?: string | null
          id?: string
          next_retry_at?: string | null
          persona_id?: string | null
          platform: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          prompt_version_id?: string | null
          published_at?: string | null
          retry_count?: number | null
          scheduled_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          body?: string
          claimed_at?: string | null
          content_item_id?: string
          created_at?: string
          error?: string | null
          error_code?: string | null
          id?: string
          next_retry_at?: string | null
          persona_id?: string | null
          platform?: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          prompt_version_id?: string | null
          published_at?: string | null
          retry_count?: number | null
          scheduled_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_variants_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_variants_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_variants_platform_platform_fkey"
            columns: ["platform"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "post_variants_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_variants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      posting_schedules: {
        Row: {
          created_at: string
          days_of_week: number[]
          hour: number
          id: string
          is_active: boolean
          minute: number
          persona_id: string
          platform: string
          timezone: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          days_of_week?: number[]
          hour: number
          id?: string
          is_active?: boolean
          minute: number
          persona_id: string
          platform: string
          timezone?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          days_of_week?: number[]
          hour?: number
          id?: string
          is_active?: boolean
          minute?: number
          persona_id?: string
          platform?: string
          timezone?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "posting_schedules_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posting_schedules_platform_platform_fkey"
            columns: ["platform"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "posting_schedules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      prompt_versions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          source: string
          system_prompt: string
          version_number: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          source?: string
          system_prompt: string
          version_number: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          source?: string
          system_prompt?: string
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_attempts: {
        Row: {
          attempt_number: number
          attempted_at: string
          completed_at: string | null
          error_code: string | null
          error_detail: string | null
          id: string
          idempotency_key: string
          platform_post_id: string | null
          platform_post_url: string | null
          post_variant_id: string
          status: string
          workspace_id: string
        }
        Insert: {
          attempt_number?: number
          attempted_at?: string
          completed_at?: string | null
          error_code?: string | null
          error_detail?: string | null
          id?: string
          idempotency_key: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          post_variant_id: string
          status?: string
          workspace_id: string
        }
        Update: {
          attempt_number?: number
          attempted_at?: string
          completed_at?: string | null
          error_code?: string | null
          error_detail?: string | null
          id?: string
          idempotency_key?: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          post_variant_id?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_attempts_post_variant_id_fkey"
            columns: ["post_variant_id"]
            isOneToOne: false
            referencedRelation: "post_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_connections: {
        Row: {
          access_token_vault_id: string | null
          connected_at: string
          id: string
          needs_reauth: boolean
          persona_id: string
          platform: string
          platform_user_id: string | null
          platform_username: string | null
          refresh_token_vault_id: string | null
          token_expires_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access_token_vault_id?: string | null
          connected_at?: string
          id?: string
          needs_reauth?: boolean
          persona_id: string
          platform: string
          platform_user_id?: string | null
          platform_username?: string | null
          refresh_token_vault_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          access_token_vault_id?: string | null
          connected_at?: string
          id?: string
          needs_reauth?: boolean
          persona_id?: string
          platform?: string
          platform_user_id?: string | null
          platform_username?: string | null
          refresh_token_vault_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_connections_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_connections_platform_platform_fkey"
            columns: ["platform"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "social_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          joined_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          joined_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          joined_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_due_variants: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          body: string
          claimed_at: string | null
          content_item_id: string
          created_at: string
          error: string | null
          error_code: string | null
          id: string
          next_retry_at: string | null
          persona_id: string | null
          platform: string
          platform_post_id: string | null
          platform_post_url: string | null
          prompt_version_id: string | null
          published_at: string | null
          retry_count: number | null
          scheduled_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "post_variants"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      increment_persona_rate_limit: {
        Args: { p_persona_id: string; p_platform: string }
        Returns: undefined
      }
      user_workspace_ids: { Args: never; Returns: string[] }
      vault_create_secret: {
        Args: { p_name: string; p_secret: string }
        Returns: string
      }
      vault_read_secret: { Args: { p_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
