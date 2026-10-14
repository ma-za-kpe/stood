# Test the hosted Yard intake

Use this walkthrough to check that a buyer can create and resume a private brief in the hosted Yard app. Use disposable test content; do not enter credentials or real customer information.

Open [hosted Yard](https://stood-yard-api.onrender.com/app/) and sign in with the buyer access code. Choose **Start a private intake** and enter a short test idea. Choose **Review my brief**, then **Fill blank fields with editable defaults**.

Check that the defaults include a **$100 USD** budget and the configured repository, currently `ma-za-kpe/yard-sandbox`. Choose **Reload saved version** and confirm the answers remain in the brief. The brief has eight sections: The idea; People and places; Features; Data; Stack; Services; Budget and timing; Ownership and handover.

## Request a Foreman blueprint

Before testing planning, confirm in Render that the `stood-yard-api` deploy containing the current planner-timeout fix is **Live**. The fix gives the browser up to 180 seconds for a planning request; an older frontend can show `signal timed out` while the server-side model request is still running.

When the fixed deploy is live, choose **Ask the Foreman for a blueprint** once and wait for **Blueprint’s ready. Read the tests.** The draft should be marked unsigned and show that nothing is signed or funded. Stop at this review screen; accepting the draft advances the workflow to baseline checks.

If an older page reports `signal timed out`, do not keep submitting the planning request. Reload the saved version and use **Recover saved planning attempt** if the button is available. Recovery can return the existing draft to buyer review; it does not approve, sign, or fund it.

## Clean up

After testing with disposable content, choose **Delete this intake** and confirm **Yes, delete it**. The page should say that the answers and Foreman plan for the intake were erased. Do not delete an intake containing information you intend to keep.
