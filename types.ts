
export enum Brand {
  IHG = 'IHG',
  HOLIDAY_INN = 'Holiday Inn',
  HOLIDAY_INN_EXPRESS = 'Holiday Inn Express',
  CROWNE_PLAZA = 'Crowne Plaza',
  STAYBRIDGE_SUITES = 'Staybridge Suites'
}

export type BrandKey = Brand | string;

export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ColorPreset {
  id: string;
  name?: string;
  cmyk: CMYK;
  hex?: string;
  rgb?: RGB;
  pantone?: string;
  notes?: string;
}

export interface ConditionalRule {
  id: string;
  condition: 'contains' | 'equals' | 'notEmpty' | 'isEmpty' | 'startsWith' | 'longerThan';
  value: string;
  styleOverride: Partial<FieldStyle>;
}

export interface FieldStyle {
  top: number;
  left?: number;
  right?: number;
  fontSize: number;
  color: string;
  width?: number;
  height?: number;
  maxWidth?: number;
  zIndex?: number;
  backgroundColor?: string;
  cmyk?: CMYK;
  fontWeight: string;
  fontStyle?: 'normal' | 'italic';
  fontFamily: string;
  textAlign: 'left' | 'right' | 'center';
  textTransform?: 'none' | 'uppercase' | 'capitalize' | 'lowercase' | 'titlecase';
  letterSpacing?: string;
  lineHeight?: number;
  textDecoration?: 'none' | 'underline' | 'line-through';
  opacity?: number;
  prefix?: string;
  suffix?: string;
  charLimit?: number;
  required?: boolean;
  id?: string;
  label?: string;
  value?: string;
  pattern?: string;
  conditionalRules?: ConditionalRule[];
  useBusinessDefault?: boolean;
  showInForm?: boolean;
}

export interface FontAsset {
  id: string;
  name: string;
  dataUrl: string;
  format: 'woff' | 'woff2' | 'truetype' | 'opentype';
}

export interface SideLayout {
  backgroundColor: string;
  cmykBackgroundColor?: CMYK;
  backgroundImage?: string;
  backgroundImageName?: string;
  templateOverlay?: string;
  fields: Record<string, FieldStyle>;
  fieldOrder: string[];
}

export interface Layout {
  id: string;
  brand: BrandKey;
  canvasVersion?: number;
  name: string;
  previewUrl: string;
  previewImage?: string;
  previewImageName?: string;
  templateImage?: string;
  shopifyTags?: string[];
  customFonts?: string[];
  fontAssets?: FontAsset[];
  colorPresets?: ColorPreset[];
  shopifyProductHandle?: string;
  front: SideLayout;
  back?: SideLayout;
}

export interface CardData {
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  mobile?: string;
  addressLine1: string;
  addressLine2?: string;
  website: string;
  brand: BrandKey;
  layoutId: string;
  customValues?: Record<string, string>;
}

export interface BrandConfig {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logo: string;
  layouts: Layout[];
}

export interface AppSettings {
  appName: string;
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
  businessWebsite: string;
  primaryColor: string;
  logoUrl: string;
}
