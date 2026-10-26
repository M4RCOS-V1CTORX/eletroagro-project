import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve from this module so startup also works from the repository root.
// Existing deployment environment variables retain precedence over the file.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
