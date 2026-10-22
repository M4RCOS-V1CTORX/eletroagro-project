ALTER TABLE public.document_counters
  DROP CONSTRAINT IF EXISTS document_counters_document_type_check;

ALTER TABLE public.document_counters
  ADD CONSTRAINT document_counters_document_type_check
  CHECK (document_type IN ('quote', 'sale'));

CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sale_number BIGINT NOT NULL CHECK (sale_number > 0),
  customer_id UUID,
  quote_id UUID,
  customer_name TEXT NOT NULL,
  customer_tax_identifier TEXT,
  customer_phone TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'cash', 'card_debit', 'card_credit', 'transfer', 'boleto', 'other')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'partial', 'paid')),
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  notes TEXT,
  created_by_subject TEXT NOT NULL,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  cancelled_by_subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, sale_number),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.customers(company_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (company_id, quote_id) REFERENCES public.quotes(company_id, id) ON DELETE SET NULL (quote_id),
  CHECK (discount_amount <= subtotal),
  CHECK (total = subtotal - discount_amount),
  CHECK (amount_paid <= total),
  CHECK ((amount_paid = 0 AND payment_status = 'pending')
      OR (amount_paid > 0 AND amount_paid < total AND payment_status = 'partial')
      OR (amount_paid = total AND payment_status = 'paid')),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX sales_company_quote_uq
  ON public.sales (company_id, quote_id)
  WHERE quote_id IS NOT NULL;

CREATE INDEX sales_company_date_idx
  ON public.sales (company_id, sale_date DESC, sale_number DESC);

CREATE INDEX sales_company_payment_idx
  ON public.sales (company_id, payment_status, due_date)
  WHERE status = 'completed';

CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  catalog_item_id UUID,
  item_type TEXT NOT NULL CHECK (item_type IN ('product', 'service')),
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL,
  quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (sale_id, position),
  FOREIGN KEY (company_id, sale_id) REFERENCES public.sales(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, catalog_item_id) REFERENCES public.catalog_items(company_id, id) ON DELETE SET NULL (catalog_item_id)
);

CREATE INDEX sale_items_sale_idx ON public.sale_items (company_id, sale_id, position);

CREATE TABLE public.sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'cash', 'card_debit', 'card_credit', 'transfer', 'boleto', 'other')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, sale_id) REFERENCES public.sales(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX sale_payments_sale_idx ON public.sale_payments (company_id, sale_id, received_date DESC);
