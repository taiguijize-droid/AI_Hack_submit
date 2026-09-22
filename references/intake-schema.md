# Intake Schema

```yaml
location:
  prefecture:
  municipality:

medical:
  department:
  outpatient:
  continuous_treatment:
  facility:
  pharmacy:
  patient_payment_monthly:
  patient_payment_annual:
  bill_available:

support:
  self_support_medical_status:
  disability_certificate_status:
  current_programs:

insurance:
  type:

household:
  household_size:
  income_known:

preferences:
  online:
  travel_range:
  time_constraints:
  support_goal:

unknown_fields: []
```

原則:
- 不明値を推測しない。
- unknown_fields に記録する。
- 制度判定に必要な項目だけ追加質問する。
