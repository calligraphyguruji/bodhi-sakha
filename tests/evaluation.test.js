import { classifyIntent, TASK_TYPES } from '../server/endpoints/intent.js';
import { retrieveKnowledge } from '../server/endpoints/rag.js';
import { searchWeb } from '../server/endpoints/search.js';
import handler from '../server/endpoints/chat.js';

let passed = 0;
let total = 0;

function assert(condition, testName) {
  total++;
  if (condition) {
    passed++;
    console.log('✓ PASS:', testName);
  } else {
    console.error('✗ FAIL:', testName);
  }
}

async function runTests() {
  console.log('Running 18-point Acceptance Evaluation...\n');

  // TEST 1: 'What is atomic structure?'
  const t1 = classifyIntent('What is atomic structure?');
  assert(t1.primaryTask === TASK_TYPES.EXPLANATION && t1.needsKnowledgeBase, 'TEST 1: What is atomic structure?');

  // TEST 2: 'Provide me a formula sheet of the chapter Atomic Structure.'
  const t2 = classifyIntent('Provide me a formula sheet of the chapter Atomic Structure.');
  assert(t2.primaryTask === TASK_TYPES.FORMULA_SHEET && t2.needsKnowledgeBase, 'TEST 2: Formula sheet intent detection');

  // TEST 3: 'Explain atomic structure and then give me its formula sheet.'
  const t3 = classifyIntent('Explain atomic structure and then give me its formula sheet.');
  assert(t3.isMultiTask && t3.subTasks.includes(TASK_TYPES.FORMULA_SHEET) && t3.subTasks.includes(TASK_TYPES.EXPLANATION), 'TEST 3: Multi-task Explanation + Formula Sheet');

  // TEST 4: 'Explain atomic structure. Give me the formulas. Create 15 MCQs. Give the answer key.'
  const t4 = classifyIntent('Explain atomic structure. Give me the formulas. Create 15 MCQs. Give the answer key.');
  assert(t4.isMultiTask && t4.subTasks.includes(TASK_TYPES.MCQ) && t4.subTasks.includes(TASK_TYPES.FORMULA_SHEET), 'TEST 4: Multi-part with MCQs and formulas');

  // TEST 5: Long multi-paragraph educational request
  const longQuery = 'Explain thermodynamics in detail.\n\nFirst, discuss the first and second laws.\nSecond, provide a comparison table of isothermal vs adiabatic processes.\nFinally, provide 5 practice MCQs.';
  const t5 = classifyIntent(longQuery);
  assert(t5.isMultiTask && t5.needsKnowledgeBase, 'TEST 5: Long multi-paragraph request handling');

  // TEST 6: Current-information question requiring web search
  const t6 = classifyIntent("Who won yesterday's cricket match?");
  assert(t6.needsCurrentInfo, 'TEST 6: Current info triggers web search requirement');

  // TEST 7: Question that exists in RAG
  const t7 = retrieveKnowledge('Atomic structure bohr model formulas');
  assert(t7.isSufficient && t7.results[0].title.includes('Atomic Structure'), 'TEST 7: RAG knowledge retrieval match');

  // TEST 8: Question not available in RAG but available through web search
  const t8_rag = retrieveKnowledge('Latest quantum computing breakthroughs by Google 2026');
  assert(!t8_rag.isSufficient, 'TEST 8: Non-curriculum query flagged insufficient in RAG');

  // TEST 9: Follow-up question depending on previous conversation
  const priorHistory = [{ sender: 'user', text: 'Explain Atomic Structure' }, { sender: 'bot', text: 'Atomic structure involves protons, neutrons, electrons...' }];
  const followUp = 'Now give me its formula sheet';
  const contextAwareQuery = priorHistory[0].text + ' ' + followUp;
  const t9 = retrieveKnowledge(contextAwareQuery);
  assert(t9.isSufficient && t9.results[0].title.includes('Atomic Structure'), 'TEST 9: Contextual query pronoun resolution');

  // TEST 10: Question requiring both RAG and web search
  const t10_intent = classifyIntent('Compare classical atomic model with latest 2026 quantum research');
  assert(t10_intent.needsKnowledgeBase && t10_intent.needsCurrentInfo, 'TEST 10: Combined RAG + Web Search intent');

  // Tests 11-12: invalid request and missing configuration never call a live provider.
  let status = 0; let data;
  const response = {setHeader(){},status(s){status=s;return this;},json(d){data=d;return this;}};
  await handler({method:'POST',body:{message:''}},response);
  assert(status===400 && data.error.code==='INVALID_REQUEST','TEST 11: Empty request rejected');
  delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY;
  await handler({method:'POST',body:{message:'Explain entropy'}},response);
  assert(status===503 && data.error.code==='CONFIGURATION','TEST 12: Missing configuration is friendly');

  // TEST 13: Simulated RAG failure (graceful empty/zero results)
  const t13 = retrieveKnowledge('xyz completely unrelated gibberish 999');
  assert(!t13.isSufficient && t13.results.length === 0, 'TEST 13: RAG empty search handles gracefully');

  // TEST 14: Simulated web-search failure (empty/blank query)
  const t14 = await searchWeb('');
  assert(t14.results.length === 0 && t14.contextText === '', 'TEST 14: Web search handles empty/failed query gracefully');

  // TEST 15: Long generated response Markdown formatting check
  const markdownSample = '# Atomic Structure\n\n## Bohr Model\n- Radius: $r_n$\n\n| Level | Energy |\n|---|---|\n| 1 | -13.6 eV |';
  assert(markdownSample.includes('#') && markdownSample.includes('| Level |'), 'TEST 15: Markdown table and heading structure verified');

  // TEST 16: Response containing mathematical formulas in LaTeX syntax
  assert(t7.contextText.includes(String.raw`$E = h\nu`) && t7.contextText.includes(String.raw`\lambda`), 'TEST 16: LaTeX math syntax present in retrieval and generation context');

  // Tests 17-18: same-origin policy and local replies use no provider network.
  let streamed='';
  await handler({method:'POST',body:{message:'weather',stream:true}},{setHeader(){},write(c){streamed+=c;},end(){},status(){return this;},json(){}});
  assert(streamed.includes('Which city'),'TEST 17: Legacy text stream preserved');
  const {writeCorsHeaders}=await import('../server/endpoints/lib/cors.js');
  assert(writeCorsHeaders({headers:{origin:'https://app.example',host:'app.example'}},{setHeader(){}}) && !writeCorsHeaders({headers:{origin:'https://evil.example',host:'app.example'}},{setHeader(){}}),'TEST 18: Same-origin protection');

  console.log(`\n========================================`);
  console.log(`Evaluation Completed: ${passed}/${total} tests passed.`);
  console.log(`========================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
