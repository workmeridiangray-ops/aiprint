import type { Metadata } from 'next';
import EnquiryForm from './form';
export const metadata: Metadata = { title: 'Contact us', description: 'Send an enquiry about the artwork preparation service.' };
export default function Contact() { return <><h1>Contact us</h1><p className="lead">Tell us what you need and we will reply by email. Please do not send files here.</p><EnquiryForm /></>; }
