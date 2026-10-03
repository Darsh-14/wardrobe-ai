-- Smoke test: seed data shapes + RLS isolation between two users. Expect no ERROR lines.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ee', 'eve@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a11a', false);
\echo '--- Maya: stats, summary, wardrobe'
select wardrobe_count, saved_looks, days_styled from user_stats;
select label, count from category_summary order by sort_order;
select name, category, wear_count, worn_often from wardrobe_items_view order by name;
\echo '--- Maya wears the look twice the same day (second is a no-op)'
select wear_look('00000000-0000-0000-0000-0000000100c1');
select wear_look('00000000-0000-0000-0000-0000000100c1');
select days_styled from user_stats;
select name, wear_count from wardrobe_items where name in ('Ivory poplin shirt', 'City sneakers') order by name;
select count(*) as trends_visible from trends;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ee', false);
\echo '--- Eve sees none of Maya''s rows'
select (select count(*) from wardrobe_items) items, (select count(*) from looks) looks,
       (select count(*) from look_items) look_items, (select count(*) from recommendations) recs,
       (select count(*) from profiles) profiles_visible;
select wardrobe_count from user_stats;
\echo '--- Eve cannot attach Maya''s item to her own look (expect FK error)'
insert into looks (id, user_id, occasion, style) values ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000000ee', 'Party', 'Trendy');
\set ON_ERROR_STOP off
insert into look_items values ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000b1', 0);
\echo '--- Eve cannot write rows for Maya (expect RLS error)'
insert into wardrobe_items (user_id, name, category, image_path) values ('00000000-0000-0000-0000-00000000a11a', 'x', 'Tops', 'x');
\echo '--- Eve cannot upload into Maya''s folder (expect RLS error), can into her own'
insert into storage.objects (bucket_id, name) values ('wardrobe', '00000000-0000-0000-0000-00000000a11a/x.jpg');
\set ON_ERROR_STOP on
insert into storage.objects (bucket_id, name) values ('wardrobe', '00000000-0000-0000-0000-0000000000ee/x.jpg');
\echo '--- Eve cannot write to trends or weather_cache (expect 0 rows / error)'
\set ON_ERROR_STOP off
insert into trends (city, name) values ('X', 'y');
select count(*) from weather_cache;
reset role;
\echo 'DONE'
