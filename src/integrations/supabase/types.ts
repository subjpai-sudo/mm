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
      app_settings: {
        Row: {
          id: number
          infobip_base_url: string | null
          owner_phone: string | null
          twilio_from: string | null
          updated_at: string
          viber_bot_token: string | null
          viber_owner_id: string | null
          viber_sender: string | null
          viber_webhook_url: string | null
        }
        Insert: {
          id?: number
          infobip_base_url?: string | null
          owner_phone?: string | null
          twilio_from?: string | null
          updated_at?: string
          viber_bot_token?: string | null
          viber_owner_id?: string | null
          viber_sender?: string | null
          viber_webhook_url?: string | null
        }
        Update: {
          id?: number
          infobip_base_url?: string | null
          owner_phone?: string | null
          twilio_from?: string | null
          updated_at?: string
          viber_bot_token?: string | null
          viber_owner_id?: string | null
          viber_sender?: string | null
          viber_webhook_url?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          details: Json
          id: string
          target_id: string | null
          target_label: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_label?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_label?: string | null
        }
        Relationships: []
      }
      backup_log: {
        Row: {
          error: string | null
          file_path: string | null
          finished_at: string | null
          id: string
          size_bytes: number | null
          started_at: string
          status: string
          triggered_by: string
        }
        Insert: {
          error?: string | null
          file_path?: string | null
          finished_at?: string | null
          id?: string
          size_bytes?: number | null
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Update: {
          error?: string | null
          file_path?: string | null
          finished_at?: string | null
          id?: string
          size_bytes?: number | null
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Relationships: []
      }
      billing_customers: {
        Row: {
          address: string | null
          company: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          tel: string | null
        }
        Insert: {
          address?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          tel?: string | null
        }
        Update: {
          address?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          tel?: string | null
        }
        Relationships: []
      }
      billing_invoices: {
        Row: {
          bill_to_store_id: string | null
          bill_to_type: string
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          date: string
          discount: number
          id: string
          invoice_no: string | null
          items: Json
          store_id: string | null
          subtotal: number
          tax: number
          tax_rate: number
          total: number
        }
        Insert: {
          bill_to_store_id?: string | null
          bill_to_type?: string
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          date: string
          discount?: number
          id?: string
          invoice_no?: string | null
          items?: Json
          store_id?: string | null
          subtotal?: number
          tax?: number
          tax_rate?: number
          total?: number
        }
        Update: {
          bill_to_store_id?: string | null
          bill_to_type?: string
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          date?: string
          discount?: number
          id?: string
          invoice_no?: string | null
          items?: Json
          store_id?: string | null
          subtotal?: number
          tax?: number
          tax_rate?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_bill_to_store_id_fkey"
            columns: ["bill_to_store_id"]
            isOneToOne: false
            referencedRelation: "billing_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "billing_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoices_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "billing_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_stores: {
        Row: {
          address: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          sub: string | null
          tel: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          email?: string | null
          id: string
          name: string
          sub?: string | null
          tel?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          sub?: string | null
          tel?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      mirror_sync_log: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          rows_synced: Json | null
          started_at: string
          status: string
          triggered_by: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          rows_synced?: Json | null
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          rows_synced?: Json | null
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Relationships: []
      }
      order_requests: {
        Row: {
          arrived_at: string | null
          category_id: string | null
          container_date: string | null
          created_at: string
          created_by: string | null
          decided_by: string | null
          expected_arrival_date: string | null
          id: string
          notes: string | null
          product_id: string | null
          product_name: string
          quantity: number
          status: Database["public"]["Enums"]["order_status"]
          type: Database["public"]["Enums"]["order_type"]
          viber_message: string | null
        }
        Insert: {
          arrived_at?: string | null
          category_id?: string | null
          container_date?: string | null
          created_at?: string
          created_by?: string | null
          decided_by?: string | null
          expected_arrival_date?: string | null
          id?: string
          notes?: string | null
          product_id?: string | null
          product_name: string
          quantity: number
          status?: Database["public"]["Enums"]["order_status"]
          type: Database["public"]["Enums"]["order_type"]
          viber_message?: string | null
        }
        Update: {
          arrived_at?: string | null
          category_id?: string | null
          container_date?: string | null
          created_at?: string
          created_by?: string | null
          decided_by?: string | null
          expected_arrival_date?: string | null
          id?: string
          notes?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          status?: Database["public"]["Enums"]["order_status"]
          type?: Database["public"]["Enums"]["order_type"]
          viber_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_requests_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          barcode_registered_at: string | null
          barcode_registered_by: string | null
          brand: string | null
          category_id: string | null
          created_at: string
          id: string
          image_url: string | null
          last_alert_stock: number | null
          low_stock_threshold: number
          name: string
          origin: string | null
          pcs_per_case: number | null
          price: number
          price_10: number | null
          price_case: number | null
          rack: string | null
          shelf: string | null
          size: string | null
          sku: string | null
          stock: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          barcode_registered_at?: string | null
          barcode_registered_by?: string | null
          brand?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          last_alert_stock?: number | null
          low_stock_threshold?: number
          name: string
          origin?: string | null
          pcs_per_case?: number | null
          price?: number
          price_10?: number | null
          price_case?: number | null
          rack?: string | null
          shelf?: string | null
          size?: string | null
          sku?: string | null
          stock?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          barcode_registered_at?: string | null
          barcode_registered_by?: string | null
          brand?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          last_alert_stock?: number | null
          low_stock_threshold?: number
          name?: string
          origin?: string | null
          pcs_per_case?: number | null
          price?: number
          price_10?: number | null
          price_case?: number | null
          rack?: string | null
          shelf?: string | null
          size?: string | null
          sku?: string | null
          stock?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          must_change_pin: boolean
          phone: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          must_change_pin?: boolean
          phone?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          must_change_pin?: boolean
          phone?: string | null
        }
        Relationships: []
      }
      racks: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          destination: string | null
          id: string
          product_id: string
          quantity: number
          reason: string | null
          type: Database["public"]["Enums"]["movement_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          destination?: string | null
          id?: string
          product_id: string
          quantity: number
          reason?: string | null
          type: Database["public"]["Enums"]["movement_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          destination?: string | null
          id?: string
          product_id?: string
          quantity?: number
          reason?: string | null
          type?: Database["public"]["Enums"]["movement_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "operator" | "owner" | "manager"
      movement_type: "in" | "out"
      order_status: "pending" | "approved" | "declined" | "backordered"
      order_type: "restock" | "new_order"
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
    Enums: {
      app_role: ["admin", "operator", "owner", "manager"],
      movement_type: ["in", "out"],
      order_status: ["pending", "approved", "declined", "backordered"],
      order_type: ["restock", "new_order"],
    },
  },
} as const
