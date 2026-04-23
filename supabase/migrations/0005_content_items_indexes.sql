-- Additional indexes for content_items (missed in 0004)
CREATE INDEX idx_content_items_prompt_version ON public.content_items(prompt_version_id);
CREATE INDEX idx_content_items_created ON public.content_items(created_at DESC);
