
import { Brand, BrandConfig, Layout } from './types';

const COMMON_FONTS = {
  SANS: "'Inter', sans-serif",
  GEOMETRIC: "'Montserrat', sans-serif",
  SERIF: "'Playfair Display', serif"
};

export const BRAND_CONFIGS: Record<string, BrandConfig> = {
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
        shopifyTags: ['holiday-inn-card', 'hi-green-field'],
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
        shopifyTags: ['holiday-inn-express-card', 'hie-impact'],
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
  }
};
