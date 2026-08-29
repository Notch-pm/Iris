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
  public: {
    Tables: {
      email_template_organizations: {
        Row: {
          created_at: string
          created_by: string | null
          socle_org_id: string
          template_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          socle_org_id: string
          template_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          socle_org_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_template_organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_template_organizations_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          subject: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          subject: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          subject?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
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
      notification_preferences: {
        Row: {
          email: boolean
          in_app: boolean
          kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          email?: boolean
          in_app?: boolean
          kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          email?: boolean
          in_app?: boolean
          kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          email_attempted_at: string | null
          email_attempts: number
          email_error: string | null
          email_next_attempt_at: string | null
          email_sent_at: string | null
          email_status: string
          id: string
          in_app: boolean
          kind: string
          organization_id: string
          payload: Json
          read_at: string | null
          request_id: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          email_attempted_at?: string | null
          email_attempts?: number
          email_error?: string | null
          email_next_attempt_at?: string | null
          email_sent_at?: string | null
          email_status?: string
          id?: string
          in_app?: boolean
          kind: string
          organization_id: string
          payload?: Json
          read_at?: string | null
          request_id: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          email_attempted_at?: string | null
          email_attempts?: number
          email_error?: string | null
          email_next_attempt_at?: string | null
          email_sent_at?: string | null
          email_status?: string
          id?: string
          in_app?: boolean
          kind?: string
          organization_id?: string
          payload?: Json
          read_at?: string | null
          request_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      permission_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          organization_id: string
          profile_id: string | null
          profile_name: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          organization_id: string
          profile_id?: string | null
          profile_name: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          organization_id?: string
          profile_id?: string | null
          profile_name?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permission_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_profile_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          organization_id: string
          profile_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          organization_id: string
          profile_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          organization_id?: string
          profile_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_profile_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_profile_assignments_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "permission_profile_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "permission_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_profile_organizations: {
        Row: {
          created_at: string
          profile_id: string
          socle_org_id: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          socle_org_id: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          socle_org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_profile_organizations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "permission_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_profile_procedures: {
        Row: {
          profile_id: string
          right_close: boolean
          right_create: boolean
          right_process: boolean
          right_view: boolean
          socle_procedure_id: string
        }
        Insert: {
          profile_id: string
          right_close?: boolean
          right_create?: boolean
          right_process?: boolean
          right_view?: boolean
          socle_procedure_id: string
        }
        Update: {
          profile_id?: string
          right_close?: boolean
          right_create?: boolean
          right_process?: boolean
          right_view?: boolean
          socle_procedure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_profile_procedures_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "permission_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          default_close: boolean
          default_create: boolean
          default_process: boolean
          default_view: boolean
          description: string | null
          id: string
          is_admin: boolean
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_close?: boolean
          default_create?: boolean
          default_process?: boolean
          default_view?: boolean
          description?: string | null
          id?: string
          is_admin?: boolean
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_close?: boolean
          default_create?: boolean
          default_process?: boolean
          default_view?: boolean
          description?: string | null
          id?: string
          is_admin?: boolean
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "permission_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
          compliance: string | null
          compliance_at: string | null
          compliance_by: string | null
          compliance_motif: string | null
          compliance_note: string | null
          copy_status: string
          created_at: string
          document_type_label: string | null
          document_type_socle_id: string | null
          email_id: string | null
          fetch_url: string | null
          file_name: string
          file_size: number | null
          form_field_key: string | null
          id: string
          mime_type: string | null
          organization_id: string
          request_id: string
          storage_path: string
          superseded_at: string | null
          superseded_by: string | null
          uploaded_by: string | null
        }
        Insert: {
          checksum?: string | null
          compliance?: string | null
          compliance_at?: string | null
          compliance_by?: string | null
          compliance_motif?: string | null
          compliance_note?: string | null
          copy_status?: string
          created_at?: string
          document_type_label?: string | null
          document_type_socle_id?: string | null
          email_id?: string | null
          fetch_url?: string | null
          file_name: string
          file_size?: number | null
          form_field_key?: string | null
          id?: string
          mime_type?: string | null
          organization_id: string
          request_id: string
          storage_path: string
          superseded_at?: string | null
          superseded_by?: string | null
          uploaded_by?: string | null
        }
        Update: {
          checksum?: string | null
          compliance?: string | null
          compliance_at?: string | null
          compliance_by?: string | null
          compliance_motif?: string | null
          compliance_note?: string | null
          copy_status?: string
          created_at?: string
          document_type_label?: string | null
          document_type_socle_id?: string | null
          email_id?: string | null
          fetch_url?: string | null
          file_name?: string
          file_size?: number | null
          form_field_key?: string | null
          id?: string
          mime_type?: string | null
          organization_id?: string
          request_id?: string
          storage_path?: string
          superseded_at?: string | null
          superseded_by?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_attachments_compliance_by_fkey"
            columns: ["compliance_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_attachments_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "request_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_attachments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_attachments_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "request_attachments"
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
      request_emails: {
        Row: {
          body: string
          created_at: string
          error: string | null
          id: string
          organization_id: string
          request_id: string
          sent_at: string | null
          sent_by: string
          status: string
          subject: string
          template_id: string | null
          template_name: string | null
          to_email: string
        }
        Insert: {
          body: string
          created_at?: string
          error?: string | null
          id?: string
          organization_id: string
          request_id: string
          sent_at?: string | null
          sent_by: string
          status?: string
          subject: string
          template_id?: string | null
          template_name?: string | null
          to_email: string
        }
        Update: {
          body?: string
          created_at?: string
          error?: string | null
          id?: string
          organization_id?: string
          request_id?: string
          sent_at?: string | null
          sent_by?: string
          status?: string
          subject?: string
          template_id?: string | null
          template_name?: string | null
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_emails_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_emails_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_emails_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
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
          procedure_snapshot: Json | null
          purged_at: string | null
          received_at: string
          reference: string
          reference_seq: number
          reference_year: number
          requester_snapshot: Json | null
          retention_until: string | null
          socle_category_label: string | null
          socle_contact_id: string | null
          socle_organization_id: string | null
          socle_organization_label: string | null
          socle_procedure_id: string | null
          socle_procedure_label: string | null
          socle_root_org_id: string
          socle_scope_org_id: string
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
          procedure_snapshot?: Json | null
          purged_at?: string | null
          received_at?: string
          reference: string
          reference_seq: number
          reference_year: number
          requester_snapshot?: Json | null
          retention_until?: string | null
          socle_category_label?: string | null
          socle_contact_id?: string | null
          socle_organization_id?: string | null
          socle_organization_label?: string | null
          socle_procedure_id?: string | null
          socle_procedure_label?: string | null
          socle_root_org_id: string
          socle_scope_org_id: string
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
          procedure_snapshot?: Json | null
          purged_at?: string | null
          received_at?: string
          reference?: string
          reference_seq?: number
          reference_year?: number
          requester_snapshot?: Json | null
          retention_until?: string | null
          socle_category_label?: string | null
          socle_contact_id?: string | null
          socle_organization_id?: string | null
          socle_organization_label?: string | null
          socle_procedure_id?: string | null
          socle_procedure_label?: string | null
          socle_root_org_id?: string
          socle_scope_org_id?: string
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
      smtp_settings: {
        Row: {
          from_email: string
          from_name: string | null
          has_password: boolean | null
          host: string
          organization_id: string
          password_secret_id: string | null
          port: number
          socle_org_id: string | null
          socle_updated_at: string | null
          synced_at: string
          use_tls: boolean
          username: string | null
        }
        Insert: {
          from_email: string
          from_name?: string | null
          has_password?: boolean | null
          host: string
          organization_id: string
          password_secret_id?: string | null
          port?: number
          socle_org_id?: string | null
          socle_updated_at?: string | null
          synced_at?: string
          use_tls?: boolean
          username?: string | null
        }
        Update: {
          from_email?: string
          from_name?: string | null
          has_password?: boolean | null
          host?: string
          organization_id?: string
          password_secret_id?: string | null
          port?: number
          socle_org_id?: string | null
          socle_updated_at?: string | null
          synced_at?: string
          use_tls?: boolean
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "smtp_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      socle_organizations: {
        Row: {
          id: string
          name: string
          obsoleted_at: string | null
          organization_id: string
          socle_id: string
          socle_parent_id: string | null
          status: string
          synced_at: string
        }
        Insert: {
          id?: string
          name: string
          obsoleted_at?: string | null
          organization_id: string
          socle_id: string
          socle_parent_id?: string | null
          status?: string
          synced_at?: string
        }
        Update: {
          id?: string
          name?: string
          obsoleted_at?: string | null
          organization_id?: string
          socle_id?: string
          socle_parent_id?: string | null
          status?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "socle_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      socle_procedure_cache: {
        Row: {
          category_name: string | null
          category_socle_id: string | null
          name: string
          obsoleted_at: string | null
          organization_id: string
          socle_id: string
          socle_root_org_id: string
          synced_at: string
          type: string | null
        }
        Insert: {
          category_name?: string | null
          category_socle_id?: string | null
          name: string
          obsoleted_at?: string | null
          organization_id: string
          socle_id: string
          socle_root_org_id: string
          synced_at?: string
          type?: string | null
        }
        Update: {
          category_name?: string | null
          category_socle_id?: string | null
          name?: string
          obsoleted_at?: string | null
          organization_id?: string
          socle_id?: string
          socle_root_org_id?: string
          synced_at?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "socle_procedure_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          counters: Json
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          started_at: string
          status: string
        }
        Insert: {
          counters?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          started_at?: string
          status?: string
        }
        Update: {
          counters?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_path: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          is_platform_admin: boolean
          last_name: string | null
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id: string
          is_platform_admin?: boolean
          last_name?: string | null
        }
        Update: {
          avatar_path?: string | null
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
      administrable_organizations: {
        Args: { p_org_id: string }
        Returns: {
          name: string
          obsolete: boolean
          socle_org_id: string
          socle_parent_id: string
        }[]
      }
      assert_editor_can_manage_profile: {
        Args: { p_org_id: string; p_profile_id?: string }
        Returns: undefined
      }
      assert_tenant_keeps_root_admin: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      assign_permission_profile: {
        Args: { p_profile_id: string; p_user_id: string }
        Returns: Json
      }
      attach_request_piece: {
        Args: {
          p_file_name: string
          p_file_size?: number
          p_form_field_key?: string
          p_mime_type?: string
          p_replaces_id?: string
          p_request_id: string
          p_storage_path: string
        }
        Returns: Json
      }
      can_admin_request: { Args: { p_request_id: string }; Returns: boolean }
      can_manage_account: {
        Args: { p_actor_id: string; p_target_id: string }
        Returns: boolean
      }
      can_process_request: { Args: { p_request_id: string }; Returns: boolean }
      can_read_request: { Args: { p_request_id: string }; Returns: boolean }
      can_write_request: { Args: { p_request_id: string }; Returns: boolean }
      claim_notification_emails: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          kind: string
          notification_id: string
          organization_id: string
          organization_name: string
          payload: Json
          recipient_email: string
          recipient_name: string
          request_id: string
        }[]
      }
      clear_smtp_settings_from_socle: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      contact_request_counts: {
        Args: { p_org_id: string }
        Returns: {
          contact_id: string
          open_count: number
          total: number
        }[]
      }
      create_request_from_procedure: { Args: { p: Json }; Returns: Json }
      delete_permission_profile: {
        Args: { p_expected_version: number; p_profile_id: string }
        Returns: Json
      }
      eligible_assignees: {
        Args: { p_request_id: string }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      email_template_unknown_variables: {
        Args: { p_text: string }
        Returns: string[]
      }
      email_template_variables: { Args: never; Returns: string[] }
      form_attachment_required: {
        Args: { p_field: Json; p_values: Json }
        Returns: boolean
      }
      form_attachment_requirements: {
        Args: { p_form_data: Json; p_form_schema: Json }
        Returns: {
          field_key: string
          label: string
          required: boolean
        }[]
      }
      form_condition_met: {
        Args: { p_condition: Json; p_values: Json }
        Returns: boolean
      }
      form_condition_valid: { Args: { p_raw: Json }; Returns: boolean }
      form_data_key: { Args: { p_field: Json }; Returns: string }
      form_field_valid: { Args: { p_raw: Json }; Returns: boolean }
      form_node_valid: { Args: { p_raw: Json }; Returns: boolean }
      form_rule_equals: {
        Args: { p_field: Json; p_target: string }
        Returns: boolean
      }
      form_rule_includes: {
        Args: { p_field: Json; p_target: string }
        Returns: boolean
      }
      form_rule_target: { Args: { p_value: Json }; Returns: string }
      form_schema_content: { Args: { p_form_schema: Json }; Returns: Json }
      form_value_empty: { Args: { p_value: Json }; Returns: boolean }
      has_admin_scope: {
        Args: { p_org_id: string; p_socle_org_id: string }
        Returns: boolean
      }
      has_any_creation_right: { Args: { p_org_id: string }; Returns: boolean }
      has_any_creation_right_for: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: boolean
      }
      is_last_root_admin: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: boolean
      }
      is_org_admin: { Args: { p_org_id: string }; Returns: boolean }
      is_org_admin_anywhere: { Args: { p_org_id: string }; Returns: boolean }
      is_org_admin_anywhere_for: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: boolean
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_service_context: { Args: never; Returns: boolean }
      mail_context_for_user: {
        Args: { p_user_id: string }
        Returns: {
          from_email: string
          from_name: string
          host: string
          organization_id: string
          organization_name: string
          password: string
          port: number
          use_tls: boolean
          username: string
        }[]
      }
      mark_all_notifications_read: {
        Args: { p_org_id: string }
        Returns: number
      }
      mark_notifications_read: { Args: { p_ids: string[] }; Returns: number }
      member_role: { Args: { p_org_id: string }; Returns: string }
      member_role_derived: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: string
      }
      members_without_profile: {
        Args: { p_org_id: string }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      mentionable_users: {
        Args: { p_request_id: string }
        Returns: {
          avatar_path: string
          display_name: string
          email: string
          user_id: string
        }[]
      }
      message_mentions: { Args: { p_body: string }; Returns: string[] }
      my_permission_pairs: {
        Args: { p_right: string }
        Returns: {
          organization_id: string
          socle_org_id: string
          socle_procedure_id: string
        }[]
      }
      my_rights: { Args: { p_org_id: string }; Returns: Json }
      nil_procedure: { Args: never; Returns: string }
      notification_channels_for: {
        Args: { p_kind: string; p_user_id: string }
        Returns: {
          use_email: boolean
          use_in_app: boolean
        }[]
      }
      notification_email_max_attempts: { Args: never; Returns: number }
      permission_coverage_report: {
        Args: { p_org_id: string }
        Returns: {
          open_requests: number
          org_name: string
          procedure_name: string
          socle_org_id: string
          socle_procedure_id: string
        }[]
      }
      permission_pairs_of: {
        Args: { p_org_id?: string; p_profile_ids: string[]; p_right: string }
        Returns: {
          organization_id: string
          socle_org_id: string
          socle_procedure_id: string
        }[]
      }
      permission_profile_scope: {
        Args: { p_profile_id: string }
        Returns: {
          socle_org_id: string
        }[]
      }
      push_notification: {
        Args: {
          p_actor_id: string
          p_extra?: Json
          p_kind: string
          p_org_id: string
          p_reference: string
          p_request_id: string
          p_subject: string
          p_user_id: string
        }
        Returns: undefined
      }
      qualify_request_attachment: {
        Args: {
          p_attachment_id: string
          p_compliance: string
          p_motif?: string
          p_note?: string
        }
        Returns: Json
      }
      refresh_member_roles: { Args: { p_org_id: string }; Returns: undefined }
      refresh_request_scope_org: {
        Args: { p_org_id?: string }
        Returns: number
      }
      request_exists: { Args: { p_id: string }; Returns: boolean }
      request_pieces_blocking: {
        Args: { p_form_data: Json; p_form_schema: Json; p_request_id: string }
        Returns: string[]
      }
      request_right_for: {
        Args: {
          p_org_id: string
          p_right: string
          p_socle_org_id: string
          p_socle_procedure_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      request_scope_org: {
        Args: { p_org_id: string; p_socle_org_id: string }
        Returns: string
      }
      revoke_permission_profile: {
        Args: { p_profile_id: string; p_user_id: string }
        Returns: Json
      }
      rights_array: {
        Args: {
          p_close: boolean
          p_create: boolean
          p_process: boolean
          p_view: boolean
        }
        Returns: Json
      }
      save_permission_profile: { Args: { p: Json }; Returns: Json }
      set_permission_profile_status: {
        Args: {
          p_expected_version: number
          p_profile_id: string
          p_status: string
        }
        Returns: Json
      }
      settle_notification_email: {
        Args: { p_error?: string; p_id: string; p_ok: boolean }
        Returns: undefined
      }
      settle_request_email: {
        Args: { p_error?: string; p_id: string; p_ok: boolean }
        Returns: undefined
      }
      shares_org_with: { Args: { p_user_id: string }; Returns: boolean }
      skip_notification_email: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      smtp_config_for_org: {
        Args: { p_org_id: string }
        Returns: {
          from_email: string
          from_name: string
          host: string
          organization_id: string
          organization_name: string
          password: string
          port: number
          use_tls: boolean
          username: string
        }[]
      }
      start_request_email: {
        Args: {
          p_attachments?: Json
          p_body: string
          p_request_id: string
          p_sent_by: string
          p_subject: string
          p_template_id?: string
          p_template_name?: string
          p_to_email: string
        }
        Returns: string
      }
      sync_smtp_settings_from_socle: {
        Args: {
          p_from_email: string
          p_from_name: string
          p_host: string
          p_org_id: string
          p_password: string
          p_port: number
          p_socle_org_id: string
          p_socle_updated_at: string
          p_use_tls: boolean
          p_username: string
        }
        Returns: undefined
      }
      user_display_name: { Args: { p_user_id: string }; Returns: string }
      user_has_request_right: {
        Args: {
          p_org_id: string
          p_right: string
          p_socle_org_id: string
          p_socle_procedure_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      uuid_or_null: { Args: { p: string }; Returns: string }
      validate_permission_profile_shape: {
        Args: { p_profile_id: string }
        Returns: undefined
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
