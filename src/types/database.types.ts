// Types du schéma Supabase Iris — GÉNÉRÉS depuis le schéma live
// (Supabase MCP `generate_typescript_types`, projet tqcoqlneybtbrrcvpkpk).
// Ne jamais éditer à la main : régénérer après chaque migration.

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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      integration_api_logs: {
        Row: {
          created_at: string
          credential_id: string | null
          error_code: string | null
          id: string
          integration_source_id: string | null
          method: string
          organization_id: string | null
          path: string
          request_id: string | null
          status: number
        }
        Insert: {
          created_at?: string
          credential_id?: string | null
          error_code?: string | null
          id?: string
          integration_source_id?: string | null
          method: string
          organization_id?: string | null
          path: string
          request_id?: string | null
          status: number
        }
        Update: {
          created_at?: string
          credential_id?: string | null
          error_code?: string | null
          id?: string
          integration_source_id?: string | null
          method?: string
          organization_id?: string | null
          path?: string
          request_id?: string | null
          status?: number
        }
        Relationships: []
      }
      integration_credentials: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          integration_source_id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          integration_source_id: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes: string[]
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          integration_source_id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_integration_source_id_fkey"
            columns: ["integration_source_id"]
            isOneToOne: false
            referencedRelation: "integration_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sources: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          next_attempt_at: string | null
          organization_id: string
          payload: Json
          request_id: string
          status: string
          target: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_id?: string
          event_type: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          organization_id: string
          payload?: Json
          request_id: string
          status?: string
          target: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          organization_id?: string
          payload?: Json
          request_id?: string
          status?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_deliveries_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          socle_org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          socle_org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          socle_org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      request_assignments: {
        Row: {
          assigned_by: string | null
          assigned_to: string | null
          created_at: string
          id: string
          organization_id: string
          request_id: string
        }
        Insert: {
          assigned_by?: string | null
          assigned_to?: string | null
          created_at?: string
          id?: string
          organization_id: string
          request_id: string
        }
        Update: {
          assigned_by?: string | null
          assigned_to?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_assignments_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_assignments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_attachments: {
        Row: {
          checksum: string | null
          copy_status: string
          created_at: string
          document_type_label: string | null
          document_type_socle_id: string | null
          fetch_url: string | null
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          organization_id: string
          request_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          checksum?: string | null
          copy_status?: string
          created_at?: string
          document_type_label?: string | null
          document_type_socle_id?: string | null
          fetch_url?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id: string
          request_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          checksum?: string | null
          copy_status?: string
          created_at?: string
          document_type_label?: string | null
          document_type_socle_id?: string | null
          fetch_url?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id?: string
          request_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_attachments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      request_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          organization_id: string
          payload: Json
          request_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          organization_id: string
          payload?: Json
          request_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_links: {
        Row: {
          created_at: string
          created_by: string | null
          external_id: string | null
          external_type: string | null
          external_url: string | null
          id: string
          link_type: string
          organization_id: string
          request_id: string
          target_request_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          external_type?: string | null
          external_url?: string | null
          id?: string
          link_type: string
          organization_id: string
          request_id: string
          target_request_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          external_type?: string | null
          external_url?: string | null
          id?: string
          link_type?: string
          organization_id?: string
          request_id?: string
          target_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_links_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_links_target_request_id_fkey"
            columns: ["target_request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_messages: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          organization_id: string
          request_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind?: string
          organization_id: string
          request_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          organization_id?: string
          request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_sequences: {
        Row: {
          last_value: number
          organization_id: string
          year: number
        }
        Insert: {
          last_value?: number
          organization_id: string
          year: number
        }
        Update: {
          last_value?: number
          organization_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "request_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          anomalies: Json
          assigned_to: string | null
          body: string | null
          channel: string | null
          closed_at: string | null
          closure_motif: string | null
          closure_text: string | null
          created_at: string
          due_at: string | null
          external_ref: string | null
          external_url: string | null
          form_data: Json
          id: string
          idempotency_key: string | null
          identity_status: string
          ingest_fingerprint: string | null
          master_request_id: string | null
          organization_id: string
          priority: string
          purged_at: string | null
          received_at: string
          reference: string
          reference_seq: number
          reference_year: number
          retention_until: string | null
          snapshot: Json
          socle_category_label: string | null
          socle_contact_id: string | null
          socle_organization_id: string | null
          socle_organization_label: string | null
          socle_procedure_id: string | null
          socle_procedure_label: string | null
          socle_root_org_id: string
          source: string
          status: string
          subject: string
          updated_at: string
          version: number
        }
        Insert: {
          anomalies?: Json
          assigned_to?: string | null
          body?: string | null
          channel?: string | null
          closed_at?: string | null
          closure_motif?: string | null
          closure_text?: string | null
          created_at?: string
          due_at?: string | null
          external_ref?: string | null
          external_url?: string | null
          form_data?: Json
          id?: string
          idempotency_key?: string | null
          identity_status?: string
          ingest_fingerprint?: string | null
          master_request_id?: string | null
          organization_id: string
          priority?: string
          purged_at?: string | null
          received_at?: string
          reference: string
          reference_seq: number
          reference_year: number
          retention_until?: string | null
          snapshot?: Json
          socle_category_label?: string | null
          socle_contact_id?: string | null
          socle_organization_id?: string | null
          socle_organization_label?: string | null
          socle_procedure_id?: string | null
          socle_procedure_label?: string | null
          socle_root_org_id: string
          source?: string
          status?: string
          subject: string
          updated_at?: string
          version?: number
        }
        Update: {
          anomalies?: Json
          assigned_to?: string | null
          body?: string | null
          channel?: string | null
          closed_at?: string | null
          closure_motif?: string | null
          closure_text?: string | null
          created_at?: string
          due_at?: string | null
          external_ref?: string | null
          external_url?: string | null
          form_data?: Json
          id?: string
          idempotency_key?: string | null
          identity_status?: string
          ingest_fingerprint?: string | null
          master_request_id?: string | null
          organization_id?: string
          priority?: string
          purged_at?: string | null
          received_at?: string
          reference?: string
          reference_seq?: number
          reference_year?: number
          retention_until?: string | null
          snapshot?: Json
          socle_category_label?: string | null
          socle_contact_id?: string | null
          socle_organization_id?: string | null
          socle_organization_label?: string | null
          socle_procedure_id?: string | null
          socle_procedure_label?: string | null
          socle_root_org_id?: string
          source?: string
          status?: string
          subject?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_master_request_id_fkey"
            columns: ["master_request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          first_name: string | null
          id: string
          is_platform_admin: boolean
          last_name: string | null
        }
        Insert: {
          created_at?: string
          email: string
          first_name?: string | null
          id: string
          is_platform_admin?: boolean
          last_name?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          is_platform_admin?: boolean
          last_name?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_org_admin: { Args: { p_org_id: string }; Returns: boolean }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      is_org_writer: { Args: { p_org_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_service_context: { Args: never; Returns: boolean }
      member_role: { Args: { p_org_id: string }; Returns: string }
      shares_org_with: { Args: { p_user_id: string }; Returns: boolean }
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
  public: {
    Enums: {},
  },
} as const
