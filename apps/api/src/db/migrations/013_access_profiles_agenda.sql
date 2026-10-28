CREATE TABLE public.company_access_profiles(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 80),permissions JSONB NOT NULL CHECK(jsonb_typeof(permissions)='object'),
  created_by_subject TEXT NOT NULL,updated_by_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id,id),UNIQUE(company_id,name)
);
ALTER TABLE public.company_memberships ADD COLUMN access_profile_id UUID,
  ADD COLUMN last_access_at TIMESTAMPTZ,ADD COLUMN updated_by_subject TEXT,
  ADD FOREIGN KEY(company_id,access_profile_id) REFERENCES public.company_access_profiles(company_id,id) ON DELETE RESTRICT;
ALTER TABLE public.company_invitations ADD COLUMN access_profile_id UUID,
  ADD FOREIGN KEY(company_id,access_profile_id) REFERENCES public.company_access_profiles(company_id,id) ON DELETE RESTRICT;
ALTER TABLE public.appointments ADD COLUMN category TEXT CHECK(category IS NULL OR length(category) BETWEEN 2 AND 80),
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  ADD COLUMN responsible_member_id UUID REFERENCES public.company_memberships(id) ON DELETE RESTRICT,
  ADD COLUMN supplier_id UUID,
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD FOREIGN KEY(company_id,supplier_id) REFERENCES public.suppliers(company_id,id) ON DELETE RESTRICT;
CREATE INDEX appointments_responsible_time_idx ON public.appointments(company_id,responsible_member_id,starts_at) WHERE deleted_at IS NULL;
CREATE INDEX audit_search_idx ON public.audit_logs(company_id,entity_type,action,created_at DESC);
-- Deliberately no changes to existing permission JSON, roles or financial records.
