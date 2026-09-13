import { expect, it } from 'vitest';
import { completeReport } from './reportGeography';

it('joins by codes, retains zeros, and excludes other cities even when names match', () => {
  const cities = [{ city_code: 'a', name: 'City A' }, { city_code: 'b', name: 'City B' }];
  const barangays = [
    { barangay_code: 'a1', city_code: 'a', name: 'Poblacion' },
    { barangay_code: 'a2', city_code: 'a', name: 'Zero records' },
    { barangay_code: 'b1', city_code: 'b', name: 'Poblacion' },
  ];
  const result = completeReport([{ barangay_code: 'a1', barangay_name: 'Poblacion', city_name: 'Old name',
    screened_count: 5, referred_count: 2, case_count: 1, successful_outcome_count: 0, lost_to_follow_up_count: 0,
  }], barangays, cities, 'a');
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({ city_name: 'City A', screened_count: 5 });
  expect(result[1]).toMatchObject({ screened_count: 0, referred_count: 0, case_count: 0 });
  expect(completeReport([], barangays, cities, '')).toHaveLength(3);
});
