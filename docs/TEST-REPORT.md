# Build Tracker test report

Run 11/10/2026, 11:32:28 PM Eastern against the real system on this computer.
**330 of 330 checks passed.** Automatic texts went only to a fake Kixie on this Mac. Nothing left this computer.

## Logins and team

- Pass: First owner signs in with an emailed link
- Pass: Sign out returns to the login screen
- Pass: Sign in again with an emailed link
- Pass: Stays signed in after a reload
- Pass: Uninvited email is refused in plain language
- Pass: Open sign-up through the API is off
- Pass: Invite admin, staff, and crew from the app
- Pass: Each person joins from the emailed invite
- Pass: A person who ignored their invite can ask for a new link
- Pass: Remove an email whose invite was not sent
- Pass: Send an invite that failed earlier
- Pass: Sent invites leave the not-sent list
- Pass: Inviting an email nobody allowed is refused
- Pass: staff cannot send invites
- Pass: office cannot send invites
- Pass: crew cannot send invites
- Pass: A logged-out visitor cannot send invites
- Pass: A refused invite creates no login
- Pass: Edit a person, and give the office person contact access
- Pass: Setting No access locks a person out
- Pass: A person with no access reads no data
- Pass: You cannot change your own role by accident

## Subs and private contacts

- Pass: Add subs with a contact
- Pass: A sub can hold several contacts
- Pass: Change the main contact
- Pass: Delete a contact
- Pass: Insurance date and W-9 show as current
- Pass: Missing insurance is flagged
- Pass: Delete a sub with no work
- Pass: Subs join and land on their own portal
- Pass: Admin (you) reads contacts through the API
- Pass: Second admin (Blake) sees contacts
- Pass: Office person with access sees contacts
- Pass: Office person cannot open Team
- Pass: staff gets zero contacts from the API
- Pass: staff cannot add a contact through the API
- Pass: crew gets zero contacts from the API
- Pass: crew cannot add a contact through the API
- Pass: subA gets zero contacts from the API
- Pass: subA cannot add a contact through the API
- Pass: subB gets zero contacts from the API
- Pass: subB cannot add a contact through the API
- Pass: Vendors table no longer holds phone or email
- Pass: Staff cannot grant themselves contact access
- Pass: Staff read no sub login emails
- Pass: Staff see the sub list with no numbers or emails
- Pass: Staff have no Contacts button

## Jobs

- Pass: New house starts with 25 budget lines
- Pass: New house starts with a linked schedule
- Pass: All job types are offered
- Pass: Small job gets one General line
- Pass: Job header shows type and note
- Pass: Edit a job and it saves to the database
- Pass: Staff-only actions stay: admin sees delete job
- Pass: Staff have no delete-job button
- Pass: Staff cannot delete a job through the API
- Pass: Admin deletes a job

## Budget

- Pass: Edit a budget amount with cents
- Pass: Bad dollar amounts are refused
- Pass: Bought out frees unspent budget from the expected cost
- Pass: Add a budget line
- Pass: Delete an unused line

## POs

- Pass: Staff add draft POs
- Pass: Draft POs stay hidden from the sub
- Pass: Edit a draft PO
- Pass: Send POs to the subs
- Pass: Sub accepts a work order
- Pass: Sub declines a work order
- Pass: Declined PO lands on your list
- Pass: Reopen a declined PO
- Pass: Staff mark a PO accepted
- Pass: Close a finished PO
- Pass: Sub cannot raise a PO amount through the API
- Pass: Sub's API shows only their own POs

## Bills, waivers, payment block

- Pass: Sub submits a bill with a real file
- Pass: Sub cannot bill with no work order through the API
- Pass: New bill lands on your list
- Pass: Staff open the invoice from real storage
- Pass: Approving requests a conditional waiver
- Pass: Change a waiver type
- Pass: Payment is blocked with no waiver
- Pass: Staff cannot force payment past the block
- Pass: Staff cannot force payment through the API
- Pass: Sub uploads the signed waiver
- Pass: With insurance and waiver in, the bill can be paid
- Pass: Payment requests the unconditional waiver
- Pass: Staff open the uploaded waiver
- Pass: Mark a waiver received and send it back
- Pass: Staff cannot undo a payment
- Pass: Even an admin cannot change a paid amount
- Pass: Download paid bills as CSV
- Pass: Staff add a bill with a file
- Pass: Reject a bill with a reason
- Pass: Sub sees the rejection reason
- Pass: Sub sees no other sub's bills
- Pass: Sub opens their own invoice
- Pass: Reject a bill after it was approved
- Pass: Block names missing insurance and waiver
- Pass: Admin override is saved on the bill
- Pass: Admin undoes a payment
- Pass: Budget math: framing shows $65,000 committed, $30,000 paid, $5,000 over

## Change orders

- Pass: Add a change order
- Pass: Approved change raises the PO
- Pass: Approved change raises the budget
- Pass: Undo takes it back off the PO
- Pass: Reject a change order
- Pass: A credit can be negative
- Pass: Subs read no change orders through the API

## Lender draws

- Pass: Warns when a draw passes the budget
- Pass: Draw sheet shows this draw and the balance
- Pass: Draw sheet lists waivers on file
- Pass: Print the draw sheet
- Pass: Funded amount updates loan left to draw
- Pass: Delete a draft draw

## Schedule

- Pass: On-schedule status shows
- Pass: Assign a sub to a task
- Pass: Assign tasks to a team member
- Pass: Cancelling leaves the schedule alone
- Pass: A delay pushes later tasks
- Pass: Task loops are not offered
- Pass: Finish before start is refused
- Pass: A late task shows Late and makes the job behind
- Pass: Today shows the job behind
- Pass: Late task lands on your list
- Pass: Delete a task

## Call list and messages

- Pass: Unconfirmed sub is on the call list
- Pass: Call button dials the main contact
- Pass: Text is filled in with the right number, job, and address
- Pass: Email is filled in
- Pass: Opening a text logs the contact
- Pass: The contact log is saved
- Pass: Opening an email logs the contact
- Pass: Pressing Call logs the call
- Pass: A confirmed sub leaves the call list
- Pass: Contractors tab still shows them as confirmed
- Pass: Undo a confirmation
- Pass: Moving dates puts the sub back on the list
- Pass: Staff without access see no numbers or message buttons
- Pass: Office person has call and message buttons
- Pass: Sub confirms from the portal
- Pass: Portal confirmation clears the call list
- Pass: Sub's API shows only their own tasks

## What the job needs

- Pass: Add and update what the job needs
- Pass: Delete a job need

## Materials

- Pass: Add a material, and a close need-by date says Order now
- Pass: Paste a list, with quantities split out
- Pass: On-order items show when they arrive
- Pass: Late delivery is flagged
- Pass: Summary shows on order, late, and total ordered
- Pass: Mark a delivery arrived
- Pass: Filter to what is on order
- Pass: Edit and delete a material

## Colors and drawings

- Pass: Add a color with a swatch file
- Pass: Open the swatch from real storage
- Pass: Edit and delete a selection
- Pass: Upload PDF, CAD, Word, Excel, and image together
- Pass: Open a PDF drawing from real storage
- Pass: A CAD file with no type stores and comes back intact
- Pass: A file over 50 MB is refused with a clear message
- Pass: Edit file details
- Pass: Deleting a file really removes it from storage
- Pass: subA cannot open job drawings through storage
- Pass: subB cannot open job drawings through storage
- Pass: Sub cannot upload into the job folder
- Pass: A logged-out visitor cannot fetch a drawing

## Crew

- Pass: Crew see their tasks
- Pass: Crew see notes on their task
- Pass: Crew see what the job needs
- Pass: Crew see materials coming
- Pass: Crew see colors
- Pass: Crew see plans, not contracts
- Pass: Crew see no money, subs, or contacts
- Pass: Crew open the plans
- Pass: Crew cannot open a contract through storage
- Pass: Crew finish a task
- Pass: Crew mark a delivery arrived
- Pass: Crew ask for materials
- Pass: Crew are sent home from /jobs/c681edc3-5b95-4e27-bf5a-d2842b2929fc/budget
- Pass: Crew are sent home from /subs
- Pass: Crew are sent home from /calls
- Pass: Crew are sent home from /search
- Pass: Crew are sent home from /team
- Pass: Crew are sent home from /texts
- Pass: Crew read nothing from jobs through the API
- Pass: Crew read nothing from budget_lines through the API
- Pass: Crew read nothing from pos through the API
- Pass: Crew read nothing from bills through the API
- Pass: Crew read nothing from draws through the API
- Pass: Crew read nothing from vendors through the API
- Pass: Crew read nothing from vendor_contacts through the API
- Pass: Crew read nothing from materials through the API
- Pass: Crew read nothing from lien_waivers through the API
- Pass: Crew read nothing from auto_texts through the API
- Pass: Crew read nothing from notifications through the API
- Pass: Crew material list has no cost column
- Pass: Crew cannot request materials on a job they are not on
- Pass: Crew cannot finish a task that is not theirs
- Pass: Crew request lands on your list
- Pass: Request is flagged with who asked
- Pass: Crew arrival shows for the office

## Sub portal

- Pass: Sub asks for materials
- Pass: Sub still cannot read the job material list
- Pass: Sub request lands on your list under the company name
- Pass: Sub sees the order status of their request
- Pass: Sub sees no budgets, loans, or other subs
- Pass: Sub updates their task status
- Pass: Sub reads nothing from jobs through the API
- Pass: Sub reads nothing from budget_lines through the API
- Pass: Sub reads nothing from change_orders through the API
- Pass: Sub reads nothing from draws through the API
- Pass: Sub reads nothing from vendor_contacts through the API
- Pass: Sub reads nothing from materials through the API
- Pass: Sub reads nothing from selections through the API
- Pass: Sub reads nothing from documents through the API
- Pass: Sub reads nothing from scope_items through the API
- Pass: Sub reads nothing from job_steps through the API
- Pass: Sub reads nothing from notifications through the API
- Pass: Sub reads nothing from auto_texts through the API
- Pass: Sub reads nothing from auto_text_settings through the API
- Pass: Sub is sent home from /jobs/c681edc3-5b95-4e27-bf5a-d2842b2929fc/budget
- Pass: Sub is sent home from /subs
- Pass: Sub is sent home from /search
- Pass: Sub is sent home from /calls
- Pass: Sub is sent home from /team
- Pass: Sub is sent home from /texts

## Photos and site log

- Pass: Contractor sends real photos
- Pass: Contractor sees the thumbnail from real storage
- Pass: Photos land on your list
- Pass: Office sees the photos to review
- Pass: Disapproving needs a reason
- Pass: Approve one, disapprove one
- Pass: Change your mind and approve a disapproved photo
- Pass: The database refuses to disapprove with no reason
- Pass: Contractor sees the answer and the reason
- Pass: Contractor cannot approve their own photo
- Pass: An iPhone HEIC photo uploads
- Pass: Other subs cannot see those photos
- Pass: Add a site log entry
- Pass: Office photos are approved right away

## Job record

- Pass: A closed job opens on its record
- Pass: Enter who did a step on an old job
- Pass: Edit a step
- Pass: Delete a step
- Pass: Record pulls facts, needs, who did what, colors, files, materials, and photos
- Pass: Print the job record
- Pass: Printing hides the menus and buttons
- Pass: The job record makes a real PDF

## Search

- Pass: Empty search lists every job, closed ones too
- Pass: Finds the color with "alabaster"
- Pass: Finds the color with "SW-7008"
- Pass: Finds the color with "sw 7008"
- Pass: Finds the color with "sw7008"
- Pass: Search "oak plan set" finds it
- Pass: Search "truss layout" finds it
- Pass: Search "old door guy" finds it
- Pass: Search "large back porch" finds it
- Pass: Search "ORD-7" finds it
- Pass: Search "F-100" finds it
- Pass: Search "extra porch framing" finds it
- Pass: Search "trusses delivered" finds it
- Pass: Search "walls up" finds it
- Pass: Search "dana buyer" finds it
- Pass: Search "P-555" finds it
- Pass: Search "garage door swap" finds it
- Pass: Search "oak alabaster" finds it
- Pass: Search "2400" finds it
- Pass: Says when nothing matches
- Pass: Clear the search
- Pass: Filter by type
- Pass: Filter by year
- Pass: Filter by sub used
- Pass: Filter by kind of record
- Pass: Top-bar search works from any page
- Pass: Show all matches expands the list
- Pass: Open a drawing straight from search
- Pass: People with access can search contact names
- Pass: Staff cannot search contact names
- Pass: Staff cannot search contact phones

## Today page

- Pass: Today shows open jobs and closed ones separately
- Pass: A Needs-you item links to the right tab

## Automatic texts

- Pass: Installed switched off
- Pass: The page says it is off and nothing is sending
- Pass: Reminder must come after the notice
- Pass: Sending hours must make sense
- Pass: Change text settings
- Pass: Preview names who has not agreed to texts
- Pass: Preview names a bad phone number
- Pass: Office person can view the page but not change it
- Pass: Office person cannot turn texts on through the API
- Pass: Staff without access cannot open the page
- Pass: Staff cannot read the sent log
- Pass: Nobody can fake the sent log from the app
- Pass: Preview shows the exact text that would go out
- Pass: Wrong secret is refused
- Pass: Lock 1: server switch off sends nothing, even with the setting on
- Pass: Lock 2: setting off sends nothing, even with the server switch on
- Pass: Lock 3: weekend holds texts with both switches on
- Pass: A Kixie failure is logged as failed, not sent
- Pass: Failure shows in the log with the reason
- Pass: All locks open: the text reaches (fake) Kixie
- Pass: The request has the number, words, and sender Kixie expects
- Pass: Contacts who have not agreed got nothing
- Pass: A sent text marks the sub as contacted
- Pass: Running again sends no duplicate
- Pass: Sent history shows it, worded as accepted by Kixie
- Pass: Sent history shows Eastern time
- Pass: Turn off in the app stops sending
- Pass: Turn on in the app asks first and flips the setting
- Pass: Left switched OFF at the end of testing

## Phones

- Pass: No sideways scroll: owner /
- Pass: No sideways scroll: owner /calls
- Pass: No sideways scroll: owner /search?q=alabaster
- Pass: No sideways scroll: owner /subs
- Pass: No sideways scroll: owner /team
- Pass: No sideways scroll: owner /texts
- Pass: No sideways scroll: owner /jobs/:job/record
- Pass: No sideways scroll: owner /jobs/:job/materials
- Pass: No sideways scroll: owner /jobs/:job/schedule
- Pass: No sideways scroll: owner /jobs/:job/bills
- Pass: No sideways scroll: owner /jobs/:job/log
- Pass: No sideways scroll: crew /
- Pass: No sideways scroll: subA /

## iPhone Safari engine

- Pass: crew signs in on iPhone Safari
- Pass: crew page fits an iPhone screen
- Pass: Crew ask for materials on iPhone, date picker included
- Pass: sub signs in on iPhone Safari
- Pass: sub page fits an iPhone screen
- Pass: Sub sends a photo on iPhone

## Whole system

- Pass: No crashes in any browser session
- Pass: No test leftovers in the sub list
