-- Supabase Storage buckets for photos. All private; the backend returns signed URLs.
-- Object paths always start with the owner's user id: "<user_id>/<file>".
--   wardrobe        : item photos and background-removed cutouts
--   looks           : AI visualizations for looks, recommendations, shopping answers
--   avatars         : profile photos (also the "see it on you" source photo)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('wardrobe', 'wardrobe', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('looks',    'looks',    false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars',  'avatars',  false,  5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Users may read their own files in every bucket and upload/replace/delete their
-- own wardrobe photos and avatar. Generated images in "looks" are written by the backend only.
create policy "own files: read" on storage.objects for select to authenticated
  using (bucket_id in ('wardrobe', 'looks', 'avatars')
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files: upload" on storage.objects for insert to authenticated
  with check (bucket_id in ('wardrobe', 'avatars')
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files: update" on storage.objects for update to authenticated
  using (bucket_id in ('wardrobe', 'avatars') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('wardrobe', 'avatars') and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files: delete" on storage.objects for delete to authenticated
  using (bucket_id in ('wardrobe', 'avatars')
         and (storage.foldername(name))[1] = auth.uid()::text);
