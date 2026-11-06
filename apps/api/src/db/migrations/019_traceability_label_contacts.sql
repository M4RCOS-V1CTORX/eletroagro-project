ALTER TABLE public.traceability_labels
  ADD COLUMN phone TEXT NOT NULL DEFAULT '' CHECK (length(phone) <= 30),
  ADD COLUMN email TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 254);
