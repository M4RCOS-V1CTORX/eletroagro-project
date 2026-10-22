ALTER TABLE public.document_counters
  DROP CONSTRAINT IF EXISTS document_counters_document_type_check;
ALTER TABLE public.document_counters
  ADD CONSTRAINT document_counters_document_type_check
  CHECK (document_type IN ('quote', 'sale', 'service_order', 'purchase'));

ALTER TABLE public.company_memberships ADD COLUMN email TEXT;
ALTER TABLE public.company_memberships ADD COLUMN display_name TEXT;

CREATE TABLE public.company_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  invited_email TEXT NOT NULL CHECK (length(trim(invited_email)) BETWEEN 3 AND 254),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role = 'member'),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_membership_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, invited_by_membership_id) REFERENCES public.company_memberships(company_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX company_invitations_pending_email_uq
  ON public.company_invitations (company_id, lower(invited_email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX company_invitations_company_expiry_idx ON public.company_invitations (company_id, expires_at);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(trim(action)) BETWEEN 1 AND 80),
  entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) BETWEEN 1 AND 80),
  entity_id UUID,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_company_date_idx ON public.audit_logs (company_id, created_at DESC);

CREATE TABLE public.financial_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  competence_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  settled_at DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled', 'cancelled')),
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('pix', 'cash', 'card_debit', 'card_credit', 'transfer', 'boleto', 'other')),
  customer_id UUID,
  supplier_id UUID,
  sale_id UUID,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'sale', 'purchase')),
  source_id UUID,
  notes TEXT,
  created_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.customers(company_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (company_id, supplier_id) REFERENCES public.suppliers(company_id, id) ON DELETE SET NULL (supplier_id),
  FOREIGN KEY (company_id, sale_id) REFERENCES public.sales(company_id, id) ON DELETE SET NULL (sale_id),
  CHECK ((status = 'settled') = (settled_at IS NOT NULL)),
  CHECK (entry_type <> 'income' OR supplier_id IS NULL),
  CHECK (entry_type <> 'expense' OR customer_id IS NULL)
);
CREATE INDEX financial_entries_company_status_due_idx ON public.financial_entries (company_id, status, due_date);
CREATE INDEX financial_entries_company_competence_idx ON public.financial_entries (company_id, competence_date DESC);
CREATE UNIQUE INDEX financial_entries_source_uq ON public.financial_entries (company_id, source_type, source_id, entry_type)
  WHERE source_id IS NOT NULL;

CREATE TABLE public.financial_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'cash', 'card_debit', 'card_credit', 'transfer', 'boleto', 'other')),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, entry_id) REFERENCES public.financial_entries(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX financial_payments_entry_idx ON public.financial_payments (company_id, entry_id, paid_at DESC);

CREATE TABLE public.service_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  order_number BIGINT NOT NULL CHECK (order_number > 0),
  customer_id UUID,
  quote_id UUID,
  sale_id UUID,
  customer_name TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  description TEXT,
  service_address TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'scheduled', 'in_progress', 'waiting_material', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  scheduled_at TIMESTAMPTZ,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  responsible_name TEXT,
  estimated_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (estimated_total >= 0),
  notes TEXT,
  created_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, order_number),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.customers(company_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (company_id, quote_id) REFERENCES public.quotes(company_id, id) ON DELETE SET NULL (quote_id),
  FOREIGN KEY (company_id, sale_id) REFERENCES public.sales(company_id, id) ON DELETE SET NULL (sale_id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX service_orders_company_status_due_idx ON public.service_orders (company_id, status, due_date);
CREATE INDEX service_orders_company_schedule_idx ON public.service_orders (company_id, scheduled_at);
CREATE UNIQUE INDEX service_orders_quote_uq ON public.service_orders (company_id, quote_id) WHERE quote_id IS NOT NULL;
CREATE UNIQUE INDEX service_orders_sale_uq ON public.service_orders (company_id, sale_id) WHERE sale_id IS NOT NULL;

CREATE TABLE public.service_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  order_id UUID NOT NULL,
  catalog_item_id UUID,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, order_id) REFERENCES public.service_orders(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, catalog_item_id) REFERENCES public.catalog_items(company_id, id) ON DELETE SET NULL (catalog_item_id)
);
CREATE INDEX service_order_items_order_idx ON public.service_order_items (company_id, order_id);

CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  customer_id UUID,
  service_order_id UUID,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  address TEXT,
  notes TEXT,
  created_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.customers(company_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (company_id, service_order_id) REFERENCES public.service_orders(company_id, id) ON DELETE SET NULL (service_order_id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX appointments_company_date_idx ON public.appointments (company_id, starts_at);

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  catalog_item_id UUID NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'adjustment')),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 2 AND 300),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'purchase', 'service_order', 'sale', 'reversal')),
  source_id UUID,
  created_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, catalog_item_id) REFERENCES public.catalog_items(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX stock_movements_item_idx ON public.stock_movements (company_id, catalog_item_id, created_at DESC);

CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  supplier_id UUID,
  purchase_number BIGINT NOT NULL CHECK (purchase_number > 0),
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  notes TEXT,
  created_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, purchase_number),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, supplier_id) REFERENCES public.suppliers(company_id, id) ON DELETE SET NULL (supplier_id)
);

CREATE TABLE public.purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  catalog_item_id UUID NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  FOREIGN KEY (company_id, purchase_id) REFERENCES public.purchases(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, catalog_item_id) REFERENCES public.catalog_items(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX purchase_items_purchase_idx ON public.purchase_items (company_id, purchase_id);

INSERT INTO public.financial_entries (
  company_id, entry_type, title, amount, competence_date, due_date, settled_at,
  status, payment_method, customer_id, sale_id, source_type, source_id, notes, created_by_subject
)
SELECT s.company_id, 'income', 'Venda #' || lpad(s.sale_number::text, 4, '0'), s.total,
       s.sale_date, s.due_date,
       CASE WHEN s.payment_status = 'paid' THEN s.sale_date ELSE NULL END,
       CASE WHEN s.payment_status = 'paid' THEN 'settled' ELSE 'pending' END,
       s.payment_method, s.customer_id, s.id, 'sale', s.id, s.notes, s.created_by_subject
FROM public.sales s
WHERE s.status = 'completed' AND s.total > 0
ON CONFLICT (company_id, source_type, source_id, entry_type) WHERE source_id IS NOT NULL DO NOTHING;

INSERT INTO public.financial_payments (company_id, entry_id, amount, payment_method, paid_at, created_by_subject)
SELECT p.company_id, f.id, p.amount, p.payment_method, p.received_date, p.created_by_subject
FROM public.sale_payments p
JOIN public.financial_entries f ON f.company_id = p.company_id AND f.source_type = 'sale' AND f.source_id = p.sale_id
ON CONFLICT DO NOTHING;
