CREATE TABLE public.document_counters (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK (document_type IN ('quote')),
  last_number BIGINT NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (company_id, document_type)
);

CREATE TABLE public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  quote_number BIGINT NOT NULL CHECK (quote_number > 0),
  customer_id UUID NOT NULL,
  customer_name TEXT NOT NULL,
  customer_tax_identifier TEXT,
  customer_phone TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'expired', 'cancelled')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until DATE,
  subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  notes TEXT,
  terms TEXT,
  created_by_subject TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (company_id, id),
  UNIQUE (company_id, quote_number),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.customers(company_id, id) ON DELETE RESTRICT,
  CHECK (discount_amount <= subtotal),
  CHECK (total = subtotal - discount_amount)
);

CREATE INDEX quotes_company_status_date_idx
  ON public.quotes (company_id, status, issued_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE public.quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  quote_id UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  catalog_item_id UUID,
  item_type TEXT NOT NULL CHECK (item_type IN ('product', 'service')),
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL,
  quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (quote_id, position),
  FOREIGN KEY (company_id, quote_id) REFERENCES public.quotes(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, catalog_item_id) REFERENCES public.catalog_items(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX quote_items_quote_idx ON public.quote_items (company_id, quote_id, position);
