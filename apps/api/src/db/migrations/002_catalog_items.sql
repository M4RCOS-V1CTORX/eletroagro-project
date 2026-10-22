CREATE TABLE public.catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  item_type TEXT NOT NULL CHECK (item_type IN ('product', 'service')),
  code TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 180),
  description TEXT,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'un',
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  sale_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  minimum_stock NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 100000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX catalog_items_company_code_active_uq
  ON public.catalog_items (company_id, lower(code))
  WHERE code IS NOT NULL AND archived_at IS NULL;

CREATE INDEX catalog_items_company_type_name_idx
  ON public.catalog_items (company_id, item_type, lower(name))
  WHERE archived_at IS NULL;

