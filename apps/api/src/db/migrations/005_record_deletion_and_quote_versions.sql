ALTER TABLE public.quotes
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.quotes
  DROP CONSTRAINT quotes_company_id_customer_id_fkey;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_company_customer_fk
  FOREIGN KEY (company_id, customer_id)
  REFERENCES public.customers(company_id, id)
  ON DELETE SET NULL (customer_id);

ALTER TABLE public.quote_items
  DROP CONSTRAINT quote_items_company_id_catalog_item_id_fkey;

ALTER TABLE public.quote_items
  ADD CONSTRAINT quote_items_company_catalog_fk
  FOREIGN KEY (company_id, catalog_item_id)
  REFERENCES public.catalog_items(company_id, id)
  ON DELETE SET NULL (catalog_item_id);

CREATE TABLE public.quote_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  quote_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  snapshot JSONB NOT NULL,
  reason TEXT NOT NULL DEFAULT 'Edição do orçamento',
  actor_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, quote_id, version_number),
  FOREIGN KEY (company_id, quote_id) REFERENCES public.quotes(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX quote_versions_quote_idx
  ON public.quote_versions (company_id, quote_id, version_number DESC);
