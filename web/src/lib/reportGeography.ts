export interface ReportRow {
  barangay_code: string;
  barangay_name: string;
  city_name: string;
  screened_count: number;
  referred_count: number;
  case_count: number;
  successful_outcome_count: number;
  lost_to_follow_up_count: number;
}
export interface ReportCity { city_code: string; name: string }
export interface ReportBarangay { barangay_code: string; city_code: string; name: string }

export function completeReport(rows: ReportRow[], barangays: ReportBarangay[], cities: ReportCity[], cityCode: string): ReportRow[] {
  const counts = new Map(rows.map(row => [row.barangay_code, row]));
  const names = new Map(cities.map(city => [city.city_code, city.name]));
  return barangays.filter(b => !cityCode || b.city_code === cityCode).map(b => ({
    screened_count: 0, referred_count: 0, case_count: 0,
    successful_outcome_count: 0, lost_to_follow_up_count: 0,
    ...counts.get(b.barangay_code),
    barangay_code: b.barangay_code, barangay_name: b.name, city_name: names.get(b.city_code) ?? '',
  }));
}
