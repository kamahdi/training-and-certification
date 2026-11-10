# Open questions

**Blocking: answer before the build starts**

- **What does "priority" mean at this clinic, and who sets it?** Answered: patients coming from the emergency department go first. Still open: who sets the flag, reception at check-in or the professional? Until confirmed, both can. *Clinic (stakeholder)*
- **Does the professional have a phone or tablet within reach when calling a patient?** Answered: yes. They use a clinic-provided web app on their PC, so the queue and "Next patient" run in the browser there. *Clinic (stakeholder)*
- **Which country's health-data rules apply, and does a reason for visit count as health data there?** Answered: Belgium, under the EU GDPR. A reason for visit is health data (GDPR article 9), so v1 needs a data processing agreement with the clinic, a data protection impact assessment and EU hosting. Texts never include the reason. Still to do: confirm with a Belgian privacy lawyer. *Legal*
- **How are appointments entered today?** Answered: an online doctor-agenda system. The demo loads appointments from a sample file; a later phase connects to the agenda's API. *Clinic (stakeholder), engineering*

**Non-blocking: resolve during the build**

- Which text-message provider, and what does each message cost in the clinic's country? *Engineering*
- How many walk-ins does a typical day have, and how should they be placed between booked slots? *Data, from the pilot*
- What wording on the visit page explains a slipped estimate without alarming patients? *Design*
- How long is visit data kept, and who can see past days? *Legal*
