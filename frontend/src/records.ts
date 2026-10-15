export type AcademicRecord = {
  qualification: string;
  stream: string;
  institution: string;
  mark: string;
  year_of_passing: string;
  board: string;
};

export const EMPTY_RECORD: AcademicRecord = {
  qualification: "",
  stream: "",
  institution: "",
  mark: "",
  year_of_passing: "",
  board: "",
};

export const GENDERS = ["Female", "Male", "Other"];
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
