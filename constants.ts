
import { Brand, BrandConfig, Layout } from './types';

const COMMON_FONTS = {
  SANS: "'Inter', sans-serif",
  GEOMETRIC: "'Montserrat', sans-serif",
  SERIF: "'Playfair Display', serif"
};

export const BRAND_CONFIGS: Record<Brand, BrandConfig> = {
  [Brand.IHG]: {
    primaryColor: '#1e293b',
    secondaryColor: '#ffffff',
    accentColor: '#ca8a04',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/IHG_logo.svg/1200px-IHG_logo.svg.png',
    layouts: [
      {
        id: 'ihg-executive',
        brand: Brand.IHG,
        name: 'Executive Platinum',
        shopifyTags: ['card-designer', 'ihg-card-designer', 'ihg-business-card'],
        previewUrl: '',
        front: {
          backgroundColor: '#ffffff',
          fields: {
            name: { label: 'Full Name', top: 110, left: 30, fontSize: 18, color: '#1e293b', fontWeight: '700', fontFamily: COMMON_FONTS.GEOMETRIC, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' },
            jobTitle: { label: 'Job Title', top: 132, left: 30, fontSize: 10, color: '#ca8a04', fontWeight: '600', fontFamily: COMMON_FONTS.SANS, textAlign: 'left', textTransform: 'uppercase' },
            email: { label: 'Work Email', top: 165, left: 30, fontSize: 9, color: '#64748b', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            phone: { label: 'Phone', top: 178, left: 30, fontSize: 9, color: '#64748b', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left', pattern: '(###) ### ####' },
            mobile: { label: 'Mobile', top: 191, left: 30, fontSize: 9, color: '#64748b', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left', pattern: '(###) ### ####' },
            addressLine1: { label: 'Property Address', top: 165, left: 150, width: 220, fontSize: 9, color: '#64748b', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'right' },
            website: { label: 'Website', top: 191, left: 150, width: 220, fontSize: 10, color: '#1e293b', fontWeight: '700', fontFamily: COMMON_FONTS.SANS, textAlign: 'right' }
          },
          fieldOrder: ['name', 'jobTitle', 'email', 'phone', 'mobile', 'addressLine1', 'website']
        },
        back: {
          backgroundColor: '#1e293b',
          fields: {
            backText: { label: 'Back Text', value: 'IHG HOTELS & RESORTS', top: 100, left: 90, width: 220, textAlign: 'center', fontSize: 14, color: '#ffffff', fontWeight: '700', fontFamily: COMMON_FONTS.GEOMETRIC }
          },
          fieldOrder: ['backText']
        }
      }
    ]
  },
  [Brand.HOLIDAY_INN]: {
    primaryColor: '#008751',
    secondaryColor: '#ffffff',
    accentColor: '#ffffff',
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Holiday_Inn_logo.svg/1200px-Holiday_Inn_logo.svg.png',
    layouts: [
      {
        id: 'hi-modern',
        brand: Brand.HOLIDAY_INN,
        name: 'Green Field',
        shopifyTags: ['card-designer', 'holiday-inn-card', 'hi-green-field'],
        previewUrl: '',
        front: {
          backgroundColor: '#ffffff',
          fields: {
            name: { label: 'Full Name', top: 50, left: 40, fontSize: 16, color: '#008751', fontWeight: '700', fontFamily: COMMON_FONTS.GEOMETRIC, textAlign: 'left' },
            jobTitle: { label: 'Job Title', top: 72, left: 40, fontSize: 11, color: '#64748b', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            email: { label: 'Work Email', top: 110, left: 40, fontSize: 9, color: '#334155', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            phone: { label: 'Phone', top: 125, left: 40, fontSize: 9, color: '#334155', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left', pattern: '###-###-####' },
            addressLine1: { label: 'Property Address', top: 145, left: 40, fontSize: 9, color: '#334155', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            website: { label: 'Website', top: 175, left: 40, fontSize: 10, color: '#008751', fontWeight: '700', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' }
          },
          fieldOrder: ['name', 'jobTitle', 'email', 'phone', 'addressLine1', 'website']
        }
      }
    ]
  },
  [Brand.HOLIDAY_INN_EXPRESS]: {
    primaryColor: '#003fa7',
    secondaryColor: '#ffffff',
    accentColor: '#facc15',
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/3/30/Holiday_Inn_Express_logo.svg/1200px-Holiday_Inn_Express_logo.svg.png',
    layouts: [
      {
        id: 'hie-impact',
        brand: Brand.HOLIDAY_INN_EXPRESS,
        name: 'Express Impact',
        shopifyTags: ['card-designer', 'holiday-inn-express-card', 'hie-impact'],
        previewUrl: '',
        front: {
          backgroundColor: '#003fa7',
          fields: {
            name: { label: 'Full Name', top: 110, left: 30, fontSize: 20, color: '#ffffff', fontWeight: '700', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            jobTitle: { label: 'Job Title', top: 135, left: 30, fontSize: 10, color: '#facc15', fontWeight: '600', fontFamily: COMMON_FONTS.SANS, textAlign: 'left', textTransform: 'uppercase' },
            email: { label: 'Work Email', top: 170, left: 30, fontSize: 9, color: '#ffffff', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            phone: { label: 'Phone', top: 185, left: 30, fontSize: 9, color: '#ffffff', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left', pattern: '(###) ### ####' },
            addressLine1: { label: 'Property Address', top: 170, left: 150, width: 220, fontSize: 9, color: '#ffffff', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'right' },
            website: { label: 'Website', top: 195, left: 150, width: 220, fontSize: 10, color: '#ffffff', fontWeight: '800', fontFamily: COMMON_FONTS.SANS, textAlign: 'right' }
          },
          fieldOrder: ['name', 'jobTitle', 'email', 'phone', 'addressLine1', 'website']
        }
      }
    ]
  },
  [Brand.CROWNE_PLAZA]: {
    primaryColor: '#7a0019',
    secondaryColor: '#ffffff',
    accentColor: '#a1a1aa',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Crowne_Plaza_logo.svg/1200px-Crowne_Plaza_logo.svg.png',
    layouts: [
      {
        id: 'cp-prestige',
        brand: Brand.CROWNE_PLAZA,
        name: 'Corporate Prestige',
        shopifyTags: ['card-designer', 'crowne-plaza-card', 'cp-prestige'],
        previewUrl: '',
        front: {
          backgroundColor: '#ffffff',
          fields: {
            name: { label: 'Full Name', top: 60, left: 40, fontSize: 22, color: '#7a0019', fontWeight: '700', fontFamily: COMMON_FONTS.SERIF, textAlign: 'left' },
            jobTitle: { label: 'Job Title', top: 90, left: 40, fontSize: 11, color: '#71717a', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.1em' },
            email: { label: 'Work Email', top: 140, left: 40, fontSize: 9, color: '#18181b', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            phone: { label: 'Phone', top: 155, left: 40, fontSize: 9, color: '#18181b', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left', pattern: '+# (###) ### ####' },
            addressLine1: { label: 'Property Address', top: 170, left: 40, fontSize: 9, color: '#18181b', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            website: { label: 'Website', top: 190, left: 40, fontSize: 10, color: '#7a0019', fontWeight: '700', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' }
          },
          fieldOrder: ['name', 'jobTitle', 'email', 'phone', 'addressLine1', 'website']
        }
      }
    ]
  },
  [Brand.STAYBRIDGE_SUITES]: {
    primaryColor: '#4b2a1a',
    secondaryColor: '#ffffff',
    accentColor: '#f97316',
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/60/Staybridge_Suites_logo.svg/1200px-Staybridge_Suites_logo.svg.png',
    layouts: [
      {
        id: 'ss-warmth',
        brand: Brand.STAYBRIDGE_SUITES,
        name: 'Home Suite Home',
        shopifyTags: ['card-designer', 'staybridge-card', 'ss-warmth'],
        previewUrl: '',
        front: {
          backgroundColor: '#fdfbf7',
          fields: {
            name: { label: 'Full Name', top: 100, left: 40, fontSize: 18, color: '#4b2a1a', fontWeight: '700', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            jobTitle: { label: 'Job Title', top: 125, left: 40, fontSize: 12, color: '#f97316', fontWeight: '500', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            email: { label: 'Work Email', top: 155, left: 40, fontSize: 9, color: '#4b2a1a', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            phone: { label: 'Phone', top: 170, left: 40, fontSize: 9, color: '#4b2a1a', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left', pattern: '###.###.####' },
            addressLine1: { label: 'Property Address', top: 185, left: 40, fontSize: 9, color: '#4b2a1a', fontWeight: '400', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' },
            website: { label: 'Website', top: 200, left: 40, fontSize: 9, color: '#4b2a1a', fontWeight: '700', fontFamily: COMMON_FONTS.SANS, textAlign: 'left' }
          },
          fieldOrder: ['name', 'jobTitle', 'email', 'phone', 'addressLine1', 'website']
        }
      }
    ]
  }
};
