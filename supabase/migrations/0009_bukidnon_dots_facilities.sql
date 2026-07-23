-- ============================================================================
-- TB-Screen BHW — 0009_bukidnon_dots_facilities.sql
-- Real Bukidnon public TB-DOTS facilities (user-provided list, 2026-07-08) and
-- a "nearest facility" default per LGU.
--
-- PROXIMITY NOTE: there are no coordinates in the system, so "nearest" is
-- approximated at the MUNICIPALITY level from road-corridor adjacency — every
-- barangay inherits its municipality's assigned center. The mapping is a
-- DEFAULT ONLY: the referral form pre-selects it and the BHW can always pick
-- a different facility. Adjust the UPDATE block below as local knowledge
-- dictates.
--
-- The old seeded test facility (…d1) IS the provincial center — renamed to its
-- real name so existing users/referrals keep their FK.
-- ============================================================================

-- 1. The provincial center (existing test facility renamed).
update public.facilities
set name = 'Bukidnon Provincial Medical Center Hospital DOTS Center',
    address = 'Malaybalay City, Bukidnon'
where facility_id = '00000000-0000-0000-0000-0000000000d1';

-- 2. The ten LGU health DOTS centers.
insert into public.facilities (facility_id, name, type, address) values
  ('00000000-0000-0000-0000-0000000000d2', 'Malaybalay City Health DOTS Center',  'tb_dots', 'Malaybalay City, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000d3', 'Valencia City Health DOTS Center',    'tb_dots', 'Valencia City, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000d4', 'Don Carlos Health DOTS Center',       'tb_dots', 'Don Carlos, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000d5', 'Kalilangan Health DOTS Center',       'tb_dots', 'Kalilangan, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000d6', 'Kitaotao Health DOTS Center',         'tb_dots', 'Kitaotao, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000d7', 'Manolo Fortich Health DOTS Center',   'tb_dots', 'Manolo Fortich, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000d8', 'Maramag Health DOTS Center',          'tb_dots', 'Maramag, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000d9', 'Pangantucan Health DOTS Center',      'tb_dots', 'Pangantucan, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000da', 'San Fernando Health DOTS Center',     'tb_dots', 'San Fernando, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000db', 'Talakag Health DOTS Center',          'tb_dots', 'Talakag, Bukidnon')
on conflict (facility_id) do nothing;

-- 3. Default (nearest) DOTS center per LGU. Barangays inherit their city's
--    default. BPMC (…d1) has no LGU default — it is the provincial referral
--    option, always selectable manually.
alter table public.ref_cities
  add column if not exists default_facility_id uuid
    references public.facilities(facility_id);

update public.ref_cities set default_facility_id = v.fid::uuid
from (values
  -- Malaybalay CHO: the city + its eastern/northern neighbors
  ('101312000', '00000000-0000-0000-0000-0000000000d2'), -- City of Malaybalay
  ('101322000', '00000000-0000-0000-0000-0000000000d2'), -- Cabanglasan
  ('101305000', '00000000-0000-0000-0000-0000000000d2'), -- Impasug-Ong
  ('101310000', '00000000-0000-0000-0000-0000000000d2'), -- Lantapan
  -- Valencia CHO
  ('101321000', '00000000-0000-0000-0000-0000000000d3'), -- City of Valencia
  -- Don Carlos: the Cotabato-corridor municipalities
  ('101304000', '00000000-0000-0000-0000-0000000000d4'), -- Don Carlos
  ('101303000', '00000000-0000-0000-0000-0000000000d4'), -- Dangcagan
  ('101308000', '00000000-0000-0000-0000-0000000000d4'), -- Kibawe
  ('101302000', '00000000-0000-0000-0000-0000000000d4'), -- Damulog
  ('101306000', '00000000-0000-0000-0000-0000000000d4'), -- Kadingilan
  -- Kalilangan
  ('101307000', '00000000-0000-0000-0000-0000000000d5'), -- Kalilangan
  -- Kitaotao (Davao corridor)
  ('101309000', '00000000-0000-0000-0000-0000000000d6'), -- Kitaotao
  -- Manolo Fortich: the northern municipalities
  ('101314000', '00000000-0000-0000-0000-0000000000d7'), -- Manolo Fortich
  ('101311000', '00000000-0000-0000-0000-0000000000d7'), -- Libona
  ('101313000', '00000000-0000-0000-0000-0000000000d7'), -- Malitbog
  ('101319000', '00000000-0000-0000-0000-0000000000d7'), -- Sumilao
  -- Maramag (+ Quezon on the same stretch)
  ('101315000', '00000000-0000-0000-0000-0000000000d8'), -- Maramag
  ('101317000', '00000000-0000-0000-0000-0000000000d8'), -- Quezon
  -- Pangantucan
  ('101316000', '00000000-0000-0000-0000-0000000000d9'), -- Pangantucan
  -- San Fernando
  ('101318000', '00000000-0000-0000-0000-0000000000da'), -- San Fernando
  -- Talakag (+ Baungon along the western/Cagayan corridor)
  ('101320000', '00000000-0000-0000-0000-0000000000db'), -- Talakag
  ('101301000', '00000000-0000-0000-0000-0000000000db')  -- Baungon
) as v(code, fid)
where ref_cities.city_code = v.code;
