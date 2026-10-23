ALTER TABLE public.company_memberships
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{"commercial":true,"operations":true,"finance":true,"reports":true,"audit":true}'::jsonb;

ALTER TABLE public.company_invitations
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{"commercial":true,"operations":true,"finance":true,"reports":true,"audit":true}'::jsonb;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS document_settings JSONB NOT NULL DEFAULT '{"accentColor":"#176da3","footerText":"Obrigado pela preferência.","showSignature":true}'::jsonb;

ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS recurrence_group UUID,
  ADD COLUMN IF NOT EXISTS installment_number INTEGER,
  ADD COLUMN IF NOT EXISTS installment_count INTEGER;

ALTER TABLE public.financial_entries
  DROP CONSTRAINT IF EXISTS financial_entries_installments_check;
ALTER TABLE public.financial_entries
  ADD CONSTRAINT financial_entries_installments_check CHECK (
    (installment_number IS NULL AND installment_count IS NULL)
    OR (installment_number BETWEEN 1 AND installment_count AND installment_count BETWEEN 1 AND 120)
  );
CREATE INDEX IF NOT EXISTS financial_entries_recurrence_idx
  ON public.financial_entries (company_id, recurrence_group, installment_number);

ALTER TABLE public.document_counters
  DROP CONSTRAINT IF EXISTS document_counters_document_type_check;
ALTER TABLE public.document_counters
  ADD CONSTRAINT document_counters_document_type_check
  CHECK (document_type IN ('quote', 'sale', 'service_order', 'purchase', 'receipt'));

CREATE TABLE IF NOT EXISTS public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  receipt_number BIGINT NOT NULL CHECK (receipt_number > 0),
  financial_entry_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  payer_name TEXT NOT NULL CHECK (length(trim(payer_name)) BETWEEN 2 AND 200),
  payee_name TEXT NOT NULL CHECK (length(trim(payee_name)) BETWEEN 2 AND 200),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 2 AND 500),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_at DATE NOT NULL,
  payment_method TEXT NOT NULL,
  signature_required BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, receipt_number),
  UNIQUE (company_id, payment_id),
  FOREIGN KEY (company_id, financial_entry_id) REFERENCES public.financial_entries(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (payment_id) REFERENCES public.financial_payments(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS receipts_entry_idx ON public.receipts (company_id, financial_entry_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS public.service_order_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  service_order_id UUID NOT NULL,
  file_name TEXT NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 240),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
  content_data TEXT NOT NULL,
  caption TEXT,
  created_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, service_order_id) REFERENCES public.service_orders(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS service_order_attachments_order_idx
  ON public.service_order_attachments (company_id, service_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  company_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  browser_notifications BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_minutes INTEGER NOT NULL DEFAULT 60 CHECK (reminder_minutes BETWEEN 5 AND 10080),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, membership_id),
  FOREIGN KEY (company_id, membership_id) REFERENCES public.company_memberships(company_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  request_path TEXT NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON public.idempotency_keys (created_at);
