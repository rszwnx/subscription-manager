import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://laomjhhhjoqybiplywhi.supabase.co';
const supabaseKey = 'sb_publishable_SdBRhD-eR7ofk-Y5YYXa-w_9R2uZIQe';

export const supabase = createClient(supabaseUrl, supabaseKey);
