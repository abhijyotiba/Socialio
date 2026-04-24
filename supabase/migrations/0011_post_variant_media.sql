-- post_variant_media: links media assets to post variants with ordering
CREATE TABLE public.post_variant_media (
  post_variant_id  UUID NOT NULL REFERENCES public.post_variants(id)  ON DELETE CASCADE,
  media_asset_id   UUID NOT NULL REFERENCES public.media_assets(id)   ON DELETE CASCADE,
  position         INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (post_variant_id, media_asset_id)
);

ALTER TABLE public.post_variant_media ENABLE ROW LEVEL SECURITY;

-- workspace-scoped access: user can access rows whose variant belongs to their workspace
CREATE POLICY "post_variant_media_workspace_access"
  ON public.post_variant_media
  USING (
    post_variant_id IN (
      SELECT id FROM public.post_variants
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

-- allow insert (selection save)
CREATE POLICY "post_variant_media_workspace_insert"
  ON public.post_variant_media
  FOR INSERT
  WITH CHECK (
    post_variant_id IN (
      SELECT id FROM public.post_variants
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

-- allow delete (replacing selection)
CREATE POLICY "post_variant_media_workspace_delete"
  ON public.post_variant_media
  FOR DELETE
  USING (
    post_variant_id IN (
      SELECT id FROM public.post_variants
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

CREATE INDEX idx_post_variant_media_variant ON public.post_variant_media(post_variant_id);
