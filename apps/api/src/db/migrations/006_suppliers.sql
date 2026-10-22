CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 200),
  tax_identifier TEXT,
  phone TEXT,
  email TEXT,
  postal_code TEXT,
  street TEXT,
  street_number TEXT,
  address_complement TEXT,
  neighborhood TEXT,
  city TEXT,
  state CHAR(2),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX suppliers_company_tax_active_uq
  ON public.suppliers (company_id, tax_identifier)
  WHERE tax_identifier IS NOT NULL AND archived_at IS NULL;

CREATE INDEX suppliers_company_name_idx
  ON public.suppliers (company_id, lower(name))
  WHERE archived_at IS NULL;
