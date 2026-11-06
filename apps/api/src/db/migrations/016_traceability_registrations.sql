CREATE TABLE public.traceability_producers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 200),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE INDEX traceability_producers_company_name_idx ON public.traceability_producers(company_id, lower(name));

CREATE TABLE public.traceability_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 200),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE INDEX traceability_properties_company_name_idx ON public.traceability_properties(company_id, lower(name));

CREATE TABLE public.traceability_property_producers (
  company_id UUID NOT NULL,
  property_id UUID NOT NULL,
  producer_id UUID NOT NULL,
  PRIMARY KEY (company_id, property_id, producer_id),
  FOREIGN KEY (company_id, property_id) REFERENCES public.traceability_properties(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, producer_id) REFERENCES public.traceability_producers(company_id, id) ON DELETE CASCADE
);
CREATE INDEX traceability_property_producers_producer_idx ON public.traceability_property_producers(company_id, producer_id);
