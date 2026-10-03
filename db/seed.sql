-- Dev seed: the frontend's mock data (src/data/mock.ts) as real rows for one demo user.
-- Run after migrations, local/dev only. Demo user: maya@example.com
-- Image paths point at the Unsplash URLs the mock uses so the UI looks the same before uploads exist;
-- the API should pass through any value that already starts with "http".

insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-00000000a11a', 'maya@example.com', '{"name": "Maya Sharma"}');
-- (the signup trigger creates the profile row)

update profiles set
  city = 'New Delhi',
  avatar_path = 'https://images.unsplash.com/photo-1572251328767-e59f06f13ba1?auto=format&fit=crop&w=1000&q=86',
  profile_completion = 92,
  style_dna = 'Relaxed minimalism with a streetwear edge.',
  style_tags = array['Relaxed tailoring', 'Neutral palette', 'Silver accents', 'Clean sneakers']
where id = '00000000-0000-0000-0000-00000000a11a';

insert into wardrobe_items (id, user_id, name, category, color, material, season, image_path, wear_count) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000a11a', 'Ivory poplin shirt',  'Tops',        'Ivory', 'Cotton',  'All season', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1000&q=86', 12),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000a11a', 'Black fitted blazer', 'Outerwear',   'Black', 'Wool',    'All season', 'https://images.unsplash.com/photo-1616847220575-31b062a4cd05?auto=format&fit=crop&w=1000&q=86', 9),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000a11a', 'Straight blue jeans', 'Bottoms',     'Blue',  'Denim',   'All season', 'https://images.unsplash.com/photo-1603400521630-9f2de124b33b?auto=format&fit=crop&w=1000&q=86', 15),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-00000000a11a', 'Soft knit set',       'Tops',        'Rose',  'Knit',    'All season', 'https://images.unsplash.com/photo-1582164256364-b0eccb922bff?auto=format&fit=crop&w=1000&q=86', 2),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-00000000a11a', 'Everyday neutrals',   'Tops',        'Mixed', null,      'All season', 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=1200&q=86', 1),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-00000000a11a', 'Camel trench',        'Outerwear',   'Camel', 'Cotton',  'All season', 'https://images.unsplash.com/photo-1551232864-3f0890e580d9?auto=format&fit=crop&w=1000&q=86', 1),
  ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-00000000a11a', 'City sneakers',       'Shoes',       'White', 'Leather', 'All season', 'https://images.unsplash.com/photo-1721637686340-de9f8cebda5a?auto=format&fit=crop&w=1000&q=86', 0),
  ('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-00000000a11a', 'Silk occasion set',   'Dresses',     'Multi', 'Silk',    'All season', 'https://images.unsplash.com/photo-1572251328767-e59f06f13ba1?auto=format&fit=crop&w=1000&q=86', 0),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-00000000a11a', 'Silver hoop earrings','Accessories', 'Silver','Silver',  'All season', 'https://images.unsplash.com/photo-1551232864-3f0890e580d9?auto=format&fit=crop&w=1000&q=86', 4);

insert into looks (id, user_id, occasion, style, location, event_at, weather, title, reasoning, tags, style_match,
                   status, visualization_path, visualization_status, saved_at)
values ('00000000-0000-0000-0000-0000000100c1', '00000000-0000-0000-0000-00000000a11a',
        'Casual outing', 'Streetwear', 'Hauz Khas, New Delhi', '2025-10-18 18:30+05:30',
        '{"tempC": 22, "condition": "Partly cloudy", "advice": "Light layers recommended"}',
        'Relaxed city layers',
        'This look combines your ivory oversized shirt with straight-fit jeans for an effortless streetwear silhouette—ideal for your evening outing.',
        array['Color harmony', 'Weather ready'], 96,
        'ready', 'https://images.unsplash.com/photo-1628283866337-98faf3207e9f?auto=format&fit=crop&w=1400&q=88', 'ready', now());

select set_look_items('00000000-0000-0000-0000-0000000100c1',
  array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3',
        '00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b9']::uuid[]);

insert into trends (city, name, subtitle, image_url, rank) values
  ('New Delhi', 'Soft tailoring',        'Relaxed suiting in soft fabrics', 'https://images.unsplash.com/photo-1616847220575-31b062a4cd05?auto=format&fit=crop&w=1000&q=86', 1),
  ('New Delhi', 'Layered streetwear',    'Ready to style',                  'https://images.unsplash.com/photo-1721637686340-de9f8cebda5a?auto=format&fit=crop&w=1000&q=86', 2),
  ('New Delhi', 'Tonal neutrals',        'One colour, many textures',       'https://images.unsplash.com/photo-1582164256364-b0eccb922bff?auto=format&fit=crop&w=1000&q=86', 3),
  ('New Delhi', 'Oversized denim',       'Wide legs and boxy jackets',      'https://images.unsplash.com/photo-1721637686340-de9f8cebda5a?auto=format&fit=crop&w=1000&q=86', 4),
  ('New Delhi', 'Monochrome outfits',    'Head to toe in one shade',        'https://images.unsplash.com/photo-1599330293364-622fa6bfcf3a?auto=format&fit=crop&w=1000&q=86', 5),
  ('New Delhi', 'Minimal ethnic fusion', 'Clean lines, Indian textiles',    'https://images.unsplash.com/photo-1572251328767-e59f06f13ba1?auto=format&fit=crop&w=1000&q=86', 6);

insert into recommendations (user_id, owned_item_id, product_name, product_image_url, price_amount, price_currency,
                             description, style_match, new_looks, visualization_path)
values ('00000000-0000-0000-0000-00000000a11a', '00000000-0000-0000-0000-0000000000b4',
        'Relaxed wide-leg jean', 'https://images.unsplash.com/photo-1603400521630-9f2de124b33b?auto=format&fit=crop&w=1000&q=86',
        3490, 'INR',
        'Pair it with a relaxed wide-leg jean to balance the cropped silhouette and unlock 7 new looks.',
        94, 7, 'https://images.unsplash.com/photo-1599330293364-622fa6bfcf3a?auto=format&fit=crop&w=1000&q=86');
