// Phones (< 768px wide) get the phone layout (layouts/MobileLayout.vue) instead of layout A.
import { ref } from 'vue';

const PHONE = '(max-width: 767px)';

/** True on a phone-sized screen (follows resizes / rotation). */
export const isPhone = ref(typeof matchMedia === 'undefined' ? false : matchMedia(PHONE).matches);
if (typeof matchMedia !== 'undefined') matchMedia(PHONE).addEventListener('change', (e) => (isPhone.value = e.matches));
