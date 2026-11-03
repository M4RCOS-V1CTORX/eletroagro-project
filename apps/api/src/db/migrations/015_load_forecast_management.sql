ALTER TABLE public.load_forecasts ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.load_forecasts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.load_forecasts ADD COLUMN require_full_percentage BOOLEAN NOT NULL DEFAULT FALSE;
