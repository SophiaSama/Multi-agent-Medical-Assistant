export interface MedicalAdvice {
  conclusion: string;
  OTC_medication_recommended: string;
  food_recommended: string;
  food_restricted: string;
  drink_recommended: string;
  drink_restricted: string;
  recommended_clinic: string;
  severity_assessment: string;
  follow_up_plan: string;
}

export interface PatientRecord {
  id: string;
  name: string;
  lastConsultation?: string;
  history: string[];
}
