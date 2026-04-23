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
      brand_configs: {
        Row: {
          brand_name: string
          created_at: string
          current_prompt_version_id: string | null
          custom_system_prompt: string | null
          industry: string | null
          tone_tags: string[]
          updated_at: string
          website_url: string | null
          workspace_id: string
        }
        Insert: {
          brand_name: string
          created_at?: string
          current_prompt_version_id?: string | null
          custom_system_prompt?: string | null
          industry?: string | null
          tone_tags?: string[]
          updated_at?: string
          website_url?: string | null
          workspace_id: string
        }
        Update: {
          brand_name?: string
          created_at?: string
          current_prompt_version_id?: string | null
          custom_system_prompt?: string | null
          industry?: string | null
          tone_tags?: string[]
          updated_at?: string
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
            foreignKeyName: "brand_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          created_at: string
          id: string
          ingestion_job_id: string | null
          prompt_version_id: string | null
          summary: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingestion_job_id?: string | null
          prompt_version_id?: string | null
          summary?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ingestion_job_id?: string | null
          prompt_version_id?: string | null
          summary?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_items_ingestion_job_id_fkey"
            columns: ["ingestion_job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
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
      post_variants: {
        Row: {
          body: string
          claimed_at: string | null
          content_item_id: string
          created_at: string
          error: string | null
          error_code: string | null
          id: string
          platform: string
          platform_post_id: string | null
          platform_post_url: string | null
          prompt_version_id: string | null
          published_at: string | null
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
          platform: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          prompt_version_id?: string | null
          published_at?: string | null
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
          platform?: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          prompt_version_id?: string | null
          published_at?: string | null
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
          system_prompt: string
          version_number: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          system_prompt: string
          version_number: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
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
            foreignKeyName: "social_connections_workspace_id_fkey"
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
          platform?: string
          timezone?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "posting_schedules_workspace_id_fkey"
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
        Args: { p_worker_id: string; p_limit?: number }
        Returns: unknown[]
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
