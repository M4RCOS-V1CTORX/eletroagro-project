CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  tax_identifier TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX companies_tax_identifier_active_uq
  ON public.companies (tax_identifier)
  WHERE tax_identifier IS NOT NULL AND archived_at IS NULL;

CREATE TABLE public.company_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  auth_issuer TEXT NOT NULL CHECK (length(trim(auth_issuer)) > 0),
  auth_subject TEXT NOT NULL CHECK (length(trim(auth_subject)) > 0),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, auth_issuer, auth_subject),
  UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX company_memberships_one_active_owner_uq
  ON public.company_memberships (company_id)
  WHERE role = 'owner' AND is_active;

CREATE INDEX company_memberships_identity_idx
  ON public.company_memberships (auth_issuer, auth_subject, is_active);

CREATE FUNCTION public.enforce_active_membership_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  active_count INTEGER;
BEGIN
  IF NEW.is_active THEN
    PERFORM 1 FROM public.companies WHERE id = NEW.company_id FOR UPDATE;
    SELECT count(*) INTO active_count
    FROM public.company_memberships
    WHERE company_id = NEW.company_id
      AND is_active
      AND id <> NEW.id;

    IF active_count >= 5 THEN
      RAISE EXCEPTION 'A empresa já atingiu o limite de cinco usuários ativos.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_memberships_active_limit
  BEFORE INSERT OR UPDATE OF company_id, is_active
  ON public.company_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_active_membership_limit();

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 200),
  customer_type TEXT NOT NULL DEFAULT 'individual'
    CHECK (customer_type IN ('individual', 'business', 'other')),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX customers_tax_identifier_active_uq
  ON public.customers (company_id, tax_identifier)
  WHERE tax_identifier IS NOT NULL AND archived_at IS NULL;

CREATE INDEX customers_company_name_idx
  ON public.customers (company_id, lower(name));

CREATE INDEX customers_company_created_idx
  ON public.customers (company_id, created_at DESC);
