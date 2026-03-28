**Docgen plugin solution brainstorming-20260327\_130509-Meeting
Recording**

March 27, 2026, 6:05PM

55m 34s

![](media/hule20hej4ziiybnplfqm.png){width="0.3020833333333333in"
height="0.3020833333333333in"}**\
Samuel Bell** 0:03\
Yeah, so let me share. Let\'s share this top one. So I I made a click
word doc with.\
A few ideas that I had. One is being able to search tickets. So if I
pull up, I have way too many documents. OK, so if I come in here and you
know we come in this part, yeah, probably can search tickets now.\
Oh.\
Yep, \'cause that was the old version. Yeah, yeah, um, the second one
is.\
Just do. We talked about that yesterday, reverting the instead of you
having to ignore 1100, then it\'s the other way around. It\'s actually
you enable tickets rather than. Yeah, I was gonna say, yeah, the other
thing is that some of these tickets are no longer useful like T14. Yeah.
So if we had a search in the search for.\
Progress tickets. Yeah. On the API call that you make for this one,
it\'ll show only tickets that are currently being used. Yeah. So we
wouldn\'t. We would have a lot less tickets being shown. Yeah, um, that
was that was the. But I would the workbench tickets should be.\
Just only show the ones that you have decided to include \'cause if you
go to settings right now.\
You kinda. You have everything, yeah. And you ignore by selecting. So
instead it should include instead of ignore. Yeah, you have the full
list, you have the search option there and then you say, hey, I\'ll
include these fives. Those are the ones I\'ll be working with. Yeah,
that\'s what you see in your interface for that instance. Yeah. So the
other thing about this is you we should only.\
We can only it might make sense to search these tickets based up in
progress. Yeah. So we get rid of extra tickets that we don\'t. Got it.
Don\'t need because if you Scroll down on the bottom like perfect 165\'s
gone. So that and then that\'s on the connection side. Yeah. And then
where\'s the.\
Put this over here. My thought. I had some thoughts on the git
configuration attribute and a good like a good UI would be for it. Yeah
is that we so it should show.\
I think it should show at the start based off. I think we should be able
to select a configured product within the ticket that we want to work
with so that way it can get that configured products ID and make that
call to get the solution API slash configured product.\
In order to get the full parameters of the configured product that\'s
being that would be looked at. OK, if you go to, I guess if you minimize
step one, we\'re done with that one. Yes, the. So on the Step 2, you
kind of want to.\
Do you wanna either?\
Do it based on objects, which is what kind of what it does now, right?
That\'s kind of like, OK, I have a dictionary, I can click an object, I
can go forward or I can go backwards via the solution related. Yeah,
that\'s what I can do now in that starting point. Yeah, so but you\'re
saying that you would like to have a different options.\
I would like, I think it would be nice to be able to add in something
right here that does a search against the system, against all the
configured products. So then we can select a configured product and then
when you look at your build expression and you do the run, yeah.\
Oh.\
I guess I have to here, I\'ll just do no, no, it doesn\'t work for
single one at the moment. That\'s OK. So that\'s that\'s fine. Yeah. So
like you could do, you could have your configured product and so like if
you had a bunch of if else statements for like this one, yeah, you know
we could.\
I could be able to essentially in this view, run it against a selection
of configured products to see what gets displayed based off a configured
product that\'s in the system. So if you scroll up, it\'s basically like
having a under the starting point, maybe a step, let\'s call it a step 2
1/2.\
Which is then OK select like an like an item. Yeah yeah you\'re select
the instance or or something. It\'s not instant probably not the right
word but but.\
Yeah, it is. It is an instance of that object. Yeah. That you would like
to say, hey, this, this is what I would like to work with. Yeah. And
then you can basically when you run this formula editor and you click
run, yeah, you could run it against a specific context of that one that
you\'ve shown or everything. Yeah. So like I wrote a quick one, right?
Like a quick if.\
Statement right here of you know if I have a discount less than 10 in
between 10 and 20 or else. So it\'d be kind of nice if I could run this
against configured products and I would have like 3 different configured
products and one has a discount of less than 10, one has a discount of.\
10 and another has a discount of or like it is a discount of 15. Another
one could have a discount of 30 and then I could basically toggle the
three configured products I\'m gonna look at. So maybe even when you if
you go up again on the.\
Just yeah, click out that. So maybe even on the starting point, the
first you said OK, I have configured products and then it shows you the
list of configured products and that\'s saying OK, I know that the one I
want to work with is 01/04 and 06. Yep, \'cause that represents my
data.\
And then you could do the, yeah. And then you can then work with that in
that in your for loop because those represents your scenario. Yep. Makes
sense. Yeah. But I also think that then there should because that\'s
actually a lot that you didn\'t do in one and two alone. So I also think
that it makes sense that you\'re able to save that configuration.\
Because if you sit and work with that and you come back again, it\'s
annoying that you have to oh, what was the three instances that I want
to work on. So you kind of had a catalog of something where, for
example, if I had possibilities to click here, starting point, like save
starting point, you click that, it gives you saying, hey, these are the
ones you have saved.\
Maybe with an ability small description. So that gives you it kind of
becomes like a data set. Yeah, I agree. So let\'s call it a data set
instead, right? So you kind of based on your ticket and your object
selection, you create a data set. Yep, so.\
Yeah, this data set to work with. So maybe even maybe even make this a
tabs instead so it doesn\'t become 12345 but but the connection is that
and then you have the first thing you do in your is.\
What\'s the data I\'m gonna work with? Yeah, so it\'s almost like step
one is select your select the object you want. Yeah. Step two would be
select the object instance within the ticket that you wanna work with.
Yeah. And then step three would be this part like 3. Yeah, the form the
the formally as those comes into one. So we.\
Of course now it\'s like one to six, but actually it\'ll be area one to
three with having sub in that because that also means that it gives you
a lot more to work with. I like that approach. Yeah. So kind of like at
the top have steps like that where the first one is in it we can call
it.\
The second one is data set.\
And they could probably be sticky. So if you even Scroll down, you can
still see the tabs. Yeah, yeah, yeah, I wanna yeah. And you can you can
switch between them, right? So you can go back and and so it\'s init
data and then it\'s formula. Yeah. And then the other just like a quick
a quick thing would be I would lock the formula.\
Down like insert a formula right here. I would have the insert formula
kinda sticky. Yeah, instead of having to be like, yeah, yeah, yeah,
yeah.\
Yeah, just checking. Yeah, insert formal stick. Yeah. So have a a sticky
session in the bottom. Yeah. Mm-hmm. And then yeah, the whole expand in,
expand out is not working very well right now. So the part of the so
then.\
For the git configuration attribute, this one\'s a little more
complicated and the part of the reason why I was saying too I think the
the configure product is really needed is that you could have three
product models.\
and\
The attributes and aggregations would be different in each of those, so
that\'s what. So I\'m not too sure how you would almost have to like
explode this section based off the configured product that you would
pull in. OK, but hold on.\
So.\
To when you work with the get configured attributes.\
You see that as as different from when you work with with the object
model, yes, yes, yes. So. So we need to figure out to saying OK and not
limited to that there are different types of.\
Does is is is that on the uh on the configure product as well? This is
this is only on the configure product. OK yeah yeah um.\
So would that be that based on your selection on the data? Yeah, on the
data set? Yep, based on what you select there, you get the option of of
working in object mode or in in.\
Modeling. Modeling. Yeah. Yeah. Yeah, I think I like that. Yeah. So
object versus modeling, right?\
So you can do both, yeah. Initially maybe phase one. Would you have a
for loop where you would have a combination of those two things? So, so
this is where I would honestly if.\
I would suggest.\
I think it gets too complicated if you\'re trying to to like spoil the
ocean. Oh, here\'s like I did a solution related to configured product.
You know what I mean? I would I would almost say it\'s easier to just
select your configured product and build out your gate configuration
attribute stuff. Mm-hmm. Then it would be to be like.\
OK, I\'m in a for loop on a solution and then I did related CP and then
you know I think it just gets it. I would I would say that honestly like
if I I would view it as like this you have to come into this if
statement and enter.\
And then click here and then you can start your and you can select your
configured product.\
And which is selected. It\'s close to here, yeah, and maybe two every
time you hit.\
This it resets the starting points, but that\'s because, yeah, that\'s a
bug. It\'s because it thinks it\'s a new tag, so it goes out for you
too. OK, so yeah, I think then if I select, I think that what I\'ve
implemented in the other thing is is I call the follow mode that I can.\
Toggle so that if you have follow mode toggle on it does the. If you
highlight something it does the resolution thing, it does the ability to
set it. But as you\'re saying sometimes when you sit and work with
something it.\
It kind of interacts in a way you don\'t want to, so maybe disable,
enable the follow mode. Yeah, you know, I mean one of the one of the
questions I had to do was kind of around this this if statement stuff.
Mm-hmm. Let\'s see, is it? How do I?\
Get back.\
That\'s it. I was a little. How do I get back into editing?\
The SIP statement. You just press edit once you marked it. OK, there we
go.\
Was ever.\
I added this in manually. Do you? How do you add in? Do I just do like
make it a bit bigger? Yeah, and maybe maybe do. Not sure whether that\'s
possible. How do do I? Can you add in something in here? Yeah, you can
use time.\
OK.\
Oh, yeah. OK. Maybe, you know what I mean? Oh, here could be nice if
this was actually type ahead. Yeah. Yeah. So you\'re kind of building
like a an ID. Yeah, you know what I mean? Yeah. So when you press, yeah,
no, that shouldn\'t be a problem. Yeah. Or like the.\
Basically, being able to build out inside these if statements, I wasn\'t
too clear on how to do that, if that makes sense. So I mean almost if
there\'s like in the if statement builder, there\'s a section right here
on the if and then you do this. Mm-hmm. And there\'s another section
below this of your content.\
Does that make sense?\
So inside the if you have your if conditional and then underneath the if
underneath the if conditional you would have the content that you want
to put inside the if.\
How is that different from what you have up here? Because this would be
utilizing the like we we\'ve selected our configure product and then
this would be.\
Inside the if you wouldn\'t have to type it out. Is that you know what I
mean?\
Yeah, I guess. I mean, you could build another one, I guess. No, I just
mean if you if you start there, it will just do type ahead on that for
example, right? Yeah, you could do it that way. It will just like a
normal one. You start something and it will give you the list of what
you can enter from there and you can press enter, enter, enter and so
what do and when you press enter it will.\
It\'ll either come out with red lines below if it isn\'t resolved the
right way, or it will just become like this. It will become a blue one
like that. OK, then here\'s another one that I wanted to point out. This
is kind of where it gets tricky. So if I take a solution.\
And I\'m gonna do.\
You.\
A lot of times we do.\
Defining. So define variables. So you would you can actually go and
find. Let me pull it up. Actually, I think it\'s just not implemented.
Yeah, so let me get into a ticket.\
What\'s up then?\
Uh.\
Then let\'s these proposals will be good.\
Sounds good.\
Yeah.\
Yep, this is it. Let me see if I can replicate this. So if I add
solution.\
And then I do a for loop. That would you have import fragments, right?
No, this isn\'t an import fragment, it\'s a uh.\
So inside the for loop I can actually do at the loop variable I can do
hashtag.\
Oh, that was another thing. If you edit in here, got it. Yeah, got it.
Yeah. So just for the record, it\'s it\'s closing the input field. Yeah.
On the loop variable when you remove a character. Yeah. And then it,
well, it takes my focus away when I type in. Yeah, you know what I mean?
OK, so I have to re click in every time. I mean, I think that\'s.\
Just a bug. Yeah, yeah, of course. But of course you can do hashtags.
Just write it in the Word document and paste it in, yeah.\
So I\'m curious how. Oh yeah, that will not work right now, but yeah,
definitely so. So basically advanced. So the loop variable itself is a
function is what you\'re saying. Yeah, so.\
Oh, you have the.\
OK, so.\
Well, I think that\'s that\'s.\
Anyway, but like you you can so basically you can loop, you can find
objects that are related to the your main object.\
So yeah, it\'s basically, isn\'t that called a nested for loop? Yeah,
but then here\'s where stuff kind of gets tricky too, is that you can
you can define. I don\'t know if this is asking for too much, but you
can define then hashtag CP. So every iteration you go through in this,
yeah, so has so for the first one.\
I get, let\'s say I have three configured products in my solution, so I
get the name of each of the configured product CP0012 and three. So what
you\'re saying is that for that before iterating on those, I\'m saying
let me use that one and then do another.\
I know or or what is it that you\'re doing in basically you can do you
can. I mean this is different than.\
I think this is, this is probably more of an edge case, but I do think
actually, I mean it\'s, I think this kind of relates to like the row
group one. This might be easier to do the row group. So if I start, it
looks very, I mean this is just a normal one CP and solutions related.
Yeah, configured product solution. Yeah. So then like let\'s say I
wanted to print out the BOM for each configured product, right?\
Howard.\
And I I have to start with hashtag CP then. Mm-hmm. Is that capturable?\
And but it\'s doing. Isn\'t it doing that already? If you if you make a
new one, if it\'s not destroyed now, no, I\'ll just. And there also
needs to be some type of reset. You can\'t get back for it. Yeah, yeah,
let\'s try it broke.\
Probus.\
And if you do the, I just done.\
Yeah, that you need to.\
That\'s the row group.\
You selected configure product, you go via. How\'s that different from
what you\'re doing here? You scroll to the bottom. No, yeah, bottom in
that one.\
Here you need to be able to star your favorites as well. Yeah, in the
solution. If you scroll to the bottom of the solution. Oh, sorry, I\'m
sorry. No worries, no worries.\
Uh, OK, configure product.\
That\'s your. And then if you then look at the loop columns, those are
your. Oh, OK, OK, so you got that already, right? Yep. OK, OK, I didn\'t
realize that. Let me try and start with the for loop then.\
Yeah, maybe. OK, if if that\'s the case, what would happen if you did?\
And here there\'s like an attribute section than a related section.\
Yes. So you you would have, you can either do an attribute or you could
do related and then you know what I mean. So it\'s separated out a
little bit more. Yeah, instead of having to scroll all the way to the
bottom, it\'s in your face. And so it might be even, it might even be
favorites.\
That\'s the first one, right? And then you have, what\'s the normal one?
What we would call them attributes? Yeah, attributes. And then you would
have like relations related.\
So and this one can be a combination. So the favorites can be a
combination of ordered in A-Z. Yeah, of both of those into those. So you
can say, hey, these are the four that I work the most with. Yeah, cool.\
So, yeah, because that was like, I think, being at the bottom of. Yeah,
yeah, yeah, yeah. But I mean, huh.\
So.\
I mean.\
You insert this.\
Does it need to end the row group? I always forget. No, no. OK, but if
you instead just insert table.\
OK. I think we did it in the middle of, yeah, I mean in the middle of a
statement.\
There you go.\
I\'ll just add another one. Yeah, use.\
Insert table.\
Yeah, cool. OK, so you can see there you have the solution related.
Yeah, well.\
Let me try something real quick then. So if I wanted to.\
Let me try OK solution.\
I wanna do.\
A for loop.\
Clear. Uh, yeah, let me send. Doesn\'t work. No, it\'s it\'s fine. And
then my lead variable is gonna be my configured product.\
That\'s fine. And then.\
OK.\
Oh, I don\'t want to clear this. Is there any way to? No, that\'s yeah,
I don\'t know why it\'s reload the doctin plugin. Yeah, so there is the
whole clearing thing. You should have the connection, right?\
And if you start, it will connect automatically.\
Yeah, right. Cool. And then there it is. That\'s good. That\'s three.\
Oh, that\'s good.\
I don\'t think that\'s that\'s not the problem. The problem is I think
the way we went in because I don\'t think it\'s.\
Yeah, it might be that time yesterday we generated. Yeah, that\'s what I
was gonna check.\
Uh, 1814? No, that should be good.\
Still too.\
I\'ll just regenerate.\
Hmm.\
Mm.\
Seems right. Yeah. Trying to go back. We had that one yesterday as well.
Yeah. What happens if you click outside? Let me try and refresh maybe.
Yeah.\
Yeah, that seems to work. Yeah. So you have to hit refresh first, which
shouldn\'t. But yeah, all right, cool. OK, let me minimize that.\
Need to click the what does it take long to load? No, I think you just
you didn\'t click the ticket anymore. Yeah, yeah, it should be straight.
So I was doing a solution, then I was doing a for loop on the solution,
yeah.\
So it gets kind of tricky. So I want to my for loop variable. I want to
be see. I want to do that.\
But solution related that\'s that\'s.\
That\'s just a normal one if you go down, isn\'t it? Yeah, it is, but
I\'m saying.\
Or item and solution. Oh, OK, OK, OK, I see. OK, Sorry. Yeah, no, no,
that\'s that\'s all good. All good. That\'s clear now. Yeah. All right.
So, yeah, but that\'s when we come back to this, it will be much easier.
Yeah. Yes. And then OK, so my loop columns are there.\
And you can highlight selected and it will remove all the ones that are
not used. That could also be inverted, right? OK, so it only shows you
the ones that you actually have up there right now. What would happen if
I wanted to?\
Inside here you know I did it my solution, so I wanna do you know, maybe
I wanna do.\
Hashtag item hashtag. You know, this kind of fun stuff. Yeah, and I just
want to print out a new table at the top of the table. Basically, I\'d
like to print out.\
I want to get my configure products then inside there. What I want to do
is I want to make a new table to print out the bomb for each of the
configure products because I don\'t want it all in one big table, but I
want to separate it out and you know what I mean.\
Um, no, sure. So this is more like a manual. So basically if I did
like.\
You know, I I did a copy pastes for the just insert formula. Yeah,
insert formula. So inside this what I\'d like to do is I\'d like to do a
row group basically inside inside this.\
But.\
It\'s on.\
Hashtag item dot bomb or whatever the bomb one is. Does that make sense?
I think so. But you would then you would have the table where you would
put it in, right? Yeah, so like the a lot of times you\'ll read the.\
Configure products. So I guess like here\'s where. Here\'s where it kind
of gets complicated is now that you\'re in a for loop and you have a
related configured product.\
So is it almost like, OK, I defined my the concept of my formal for
loop. Let me lock that. Yeah, to the side. And then now I have a new and
now I\'m opening the for loop and I\'m working in there. I don\'t want
to be thinking about what I did above and below cuz that\'s only when
I\'m.\
Move out to the complete one. So almost like having a like we have on
the expression builder. If you scroll up this is kind of like OK I can
click on the for loop element and then I can work kind of like Ricardo
not to compare but.\
You have sort of. I can click on this one. This opens up with me. I get
nested the valuable name which is item. Yep. And now inside here I can
do a lot of stuff. I can then close it up. I get an overview with sort
of chunks of how it looks.\
And then I can of course click advanced view and I see the full thing.
But I can kind of work on elements inside my for. So I can basically do
nested for loops. I can do row groups inside. I can do if statements or
complete ups and something rather complex. Yeah, yeah, because like.\
I know it gets complicated, no, but I want I want it to be something
that can actually be used rather than just a toy, right? Yeah, so like,
because you know, inside the inside here you\'ll want to basically work
with the configured product now and then you\'d want to print their BOM
out.\
Inside there. And so that\'s where it gets kind of complicated because
you basically are the top one\'s the solution and your for loop is what
you\'re using. And then inside your for loop, you\'re now using your
configured product and your configured product has like a dot bomb. I
can\'t remember the exact term, but if we.\
If we think of the skeleton, right, there are a few. There are elements
which could be nested. You could have if statements inside if
statements, you could have for loops inside, so so and you can have row
groups inside, so for loops and stuff like that, but it\'s not like
there\'s 100.\
Of different things you can nest now, right? No, it\'s only it\'s only
relatively, but you could have them nested in many ways if you want to.
Can you have can you have 4 loops inside of row loops?\
Not, not really. I don\'t know. No, no, because the rogue group is just
a. So if if we thought of a UI where you kinda had saying OK.\
Maybe I was even thinking of. I mean if you if you had data and you had
functions, we pulled in a for loop. It kind of gave you a for loop with
an end and a close and you could then say OK here I\'ll resolve my
configured product via blah blah blah.\
And then I say, OK, this is my data set. I now have a data set. I pull
that data set onto the for loop and I drop it. Yep, then I can OK, I got
my concept for the for loop and then I can say inside that for loop, I
actually wanted to pull in a if statement. OK, here I have. OK, what\'s
the condition for you?\
If statement then in your data tree you kind of model saying OK this is
my condition for my if statement. Yeah so you build it up because then
you can have simple and advanced on it. And actually really to be honest
when you build it out like this all you need to select is your
solution.\
You just need to select your top level item.\
Because that\'s what\'s gonna drive everything underneath it. Yeah, your
top level. Yeah, you select your top level solution and.\
Because or and and then you would have a you would have two modes, you
would have a test and a live and test is where you can limit it the data
set saying hey I get the number of out of 1000 solutions. These are the
threes that I want to work with.\
Maybe that\'s not even needed because we are using it on top of. I would
say we I would take it anyway. What would happen if you did? So you had
a like builder mode and then the second one is like a.\
Viewer mode. And then inside here it shows what it would actually look
like. And then inside here it shows the formula. You know what I mean?
Yeah, yeah. So like, is there a way right now I\'m using the object
describe API, right? Which it\'s on the ticket level. So yeah, that
means that I only have.\
If we haven\'t created, if I create a new ticket and I create one, it
will show me one. Yep.\
Ideally, what the document generates is not on the ticket, that\'s on
the production environment, so the viewer.\
I would say what most of the time when I\'m doing, you\'re always
working on the ticket. Yeah, OK, yeah, I would. I\'ll go because I\'m
making my edits in the ticket and then whatever I wanna, I\'m gonna make
solutions and configure products all within the ticket that I\'m testing
my so that I\'m doing my building testing and that\'s my.\
Frank sometimes struggles with the whole ticket concept with the because
the production front end that a customer is targeting. Yeah, has tons of
configuration I assure. Yeah, but I mean that\'s not the basis of what.
OK, I would say most of the time when I\'m doing.\
When I\'m when I\'m editing and stuff like that, that you know, like
some of the some of the times I have changes to the model in my ticket
and then it just it it could clash. OK, so it\'s easier to just keep it
within the ticket. Yeah, OK, but then there\'s no.\
But then the builder mode and the viewer often is quite similar in the
sense of if it\'s a ticket you spawn up, yeah, you don\'t necessarily
have a thousands configured product, yeah, which is probably easier. So
it\'s probably the same. I don\'t think that that\'s not a priority one
maybe.\
Like you could do you know you could do like this would be your
describes.\
And then here would be your list calls based on the objects. This object
right here, right?\
And then?\
Because then you can select the list of objects that you have.\
And then that\'s the way you. So if you select, does that make sense?\
Yeah, I I guess in production, right. For example, if we take the bike
example and I hope that\'s different, you know, because because in.\
What\'s it called when you run?\
The data set the data foundation for the resolves.\
For example, I mean they\'re in the ticket on their examples of where
the.\
There are thousands of of instance of an object or in the ticket or not?
No, I mean, normally there\'s like, OK, I mean when I was building out
stuff, I mean maybe.\
Depending on how long I\'ve sat on the ticket, there\'s maybe like 15
configure products. OK, that\'s not a problem. No. And normally I\'ll
build out my, but it would be nice still to have sort of what we talked
about with this data set.\
That hey, I don\'t want to look at 15 and figure out which one is what.
I just want to because if I\'m mapping towards 2 scenarios, one that has
a higher discount at 50 and below because in the report that I want to
show those should be highlighted in red. Good. Then let me mark the two
instance, the two instance of a configure product where that\'s the
case.\
And those will be the foundation for my work. Yeah, I mean, I would say
like.\
The issue was running.\
If we were thinking, if you\'re thinking about doing ticket test and
live, you\'re gonna have three different refresh tokens.\
For each of those, I don\'t even think. Can we? Can we share a live by?\
That will be through self-service then, right? Or no, I\'m talking about
the doc, John. Yeah, yeah, yeah, yeah. But I am using the API to to
fetch those data out, right? Yeah, just the direct sales API that you\'d
be using. Yeah, instead, yeah.\
Because all that stuff should be saved. But I was just thinking if there
was differences, well, if you ever wanted to test the resolution of
those values on the live environment versus the ticket, yeah.\
I mean, I would say.\
Oh, OK. I mean, that\'s more edge than, yeah, I feel like. So before you
release to the customer, wouldn\'t you test it? Yes. So I\'m doing the
development of it. Yeah. And it\'s just a blank. It\'s a blank item. And
you know, a lot of times.\
We don\'t really have.\
People using test until we\'re a certain amount of way into the project,
because if they\'re using test and we\'re making changes, they\'re just
gonna be a lot of irrelevance.\
Like if the model\'s constantly changing and attributes are moving
around, then you\'re losing your configuration. So I would say the tests
doesn\'t really get used until more so the end of the project, and at
that point a lot of the documents are kind of.\
Already a little bit firmer than um.\
So I would probably say that the ticket is fine for now. And then if
someone, yeah, you know, um.\
Yeah, this I think is where it gets to me is the trickiest part is these
for loops.\
Because we\'re kind of, yeah, how to simplify complexity? Yeah, you know
what I mean? And understanding how like does do you do the for loop and
then?\
You can.\
Come in here and it\'s like it opens up sort of like a new editor and
it\'s kind of like a new instance besides the starting points already
selected because the starting point\'s defined in the for loop and then
you would want to add like new tag types in and stuff like that.\
That\'s why I\'m saying that that it would.\
The idea of having sort of this visual representations. Yeah, of the
difference, yeah, where you OK, it\'s basically like a skeleton, right?
It was saying, OK, I\'ll start with a for loop where I now have defined
my if.\
I have a data set that I can attach to that. Then I can say, OK, do I
know that I have nested of stuff or is it just a simple for loop? No,
it\'s just a simple for loop. OK, that\'s fine. Or if I didn\'t open it
up, we\'ll say, well, I actually need to have an if statement inside of
it with a row group.\
Actually, what could simplify a lot of this? Your your document
generation is defined by a single object.\
So when you create a document, you assign it to an object. So I can,
yeah, show you. Yeah. So technically your starting point is gonna be
defined.\
But in the system already.\
So you\'re not starting like it\'s not almost a selectable starting
point, but it\'s like like it\'s every time you create a new. Yeah, how
I understood document is that you when you create the document inside
tact and you decide where it should start. Yeah, so I\'m saying like the
starting point almost should be like.\
It shouldn\'t be changeable, yeah.\
You can set it in there, right? If you go, yeah, I know. But I\'m saying
it\'s like you. So I think actually the starting point, yeah, you lock
it once. Yeah. Yeah. And then I don\'t think because I think when I
yeah, it shouldn\'t be changeable once you set it once again, that can
go.\
That that will be so, so will be the ticket, the starting point, yeah.
What happens if we change this around a little bit and when you connect
to it?\
You just select your. You also select your object.\
But would you always can\'t you be working towards different objects
when connecting to the same ticket? No, I mean you would spin up a new.\
Yeah, I guess. I guess because the connection would stay. Yeah, I think
we should keep it in the in the data. Yeah. But you know what I mean? I
think there needs to be a section. It\'s kind of almost when you spin up
a new document, right? Like if I come in and make a new one now.\
And I do add insurance or sorry and I open doc John, yeah.\
I have to reconnect.\
Yeah, So what happens if when I reconnect here?\
You know, I can I I do this.\
I\'m part of like if you if you click if by the way it will it will
stick if you click. Oh yeah, no, I click what?\
If you open it.\
Yeah, the star. Yeah, there you go. So now if you reload the doc Gen.\
Oh, there we go. It goes in. It should go in all the way. Yeah, I think
if we had tabs right here, basically you can just select your.\
Like you\'re like it\'s almost like you\'re like it\'s almost labeled
your document object. Does that make sense? So you actually start with
creating a document in the sidebar? Yeah, yeah, so like you you spin up
your Word doc.\
And then and you know how we talked about those tabs. What would happen
if we had a tab like the first tab is just or there\'s somewhere
there\'s somewhere where kind of you just set your starting your
starting object once and then you shouldn\'t really see it again
because.\
It\'s not really a changeable thing. Yeah, and it should actually see.
OK, it would be. It could actually just recognize based off the name of
the document.\
Uh, sometimes it\'s not really. No, no, I mean that to to to this. Oh
yeah, yeah, yeah, the the saving office. Yeah, saying OK, OK, is this a
new document you doc?\
Versus old one, right? How does it figure out if it\'s an existing
document or not? OK, I mean, I think it doesn\'t. That part\'s not too
important because I don\'t think it would take too long to just be like,
OK, I\'m, I\'m coming in here, I\'m adding it in and this is my.\
Yeah, so you start with a list of documents where you the first part of
that document will be. You have a number of different data sets defined
that you\'re going to use for that document. You would have your
starting points defined. Yeah, and then that kind of gives your
container different elements you can use forward.\
I guess the reason why I thought, so I guess like maybe, you know, like
in terms of the UI, it\'s like, you know, you\'re the like set up
almost. Yeah, that\'s my ET issue. Yeah. And then that\'s the ticket.\
Plus and starting point. And I think this would help because to me, like
when it\'s all in this one list, it seems like it\'s constantly
editable. Yeah, you know what I mean? Yeah, yeah. So if it\'s in a tab
setting, then you go to your next tab and that\'s your actual like
formula builder and imagine the data sets being sort of documents.\
Specific generic stuff you can do saying, OK, I\'ll work with this so
you can come back and you can pull that in to that. It becomes a
document project. Yep, Yep, right. Doc project. Yeah. So then I think
then you can do the. It\'s a DP and it\'s not that type of DP. Yeah. So
then when you do your for loop.\
Look like, yeah, yeah.\
And you don\'t do your for loop, but you actually build up your
structure. Yeah, so then like in the formula builder, then you would. So
then like you kind of your set up and then you have like your formula
builder or whatever you call it. Yeah, but if this even becomes, instead
of being a formula, it becomes a structure.\
Where each of the structure elements you can add multiple formula
elements to that \'cause then the way you will be supporting nesting.
Yeah yeah, but I\'m saying like this is this section. Then I think it
would make sense to be your main builder.\
It\'s like that\'s that\'s where like you would start up a new. So you
know sometimes I might wanna do one expression here and then then I I
then I wanna do some like.\
Something else you know and then I maybe down here I want a new
expression. So what I was thinking was that\'s why it would make sense
to have the setup and then you have your formula builder where each time
you make a new expression it kind of.\
That\'s where you see it. Yeah. So it\'s almost steps. Yeah. So you the
document and you can do section formula sections in the document and you
can then if you open a formula section that gives you and in that
formula section you didn\'t have the possibility to do nested stuff.
Yeah. So step one is that structure.\
With the formula sections and supporting single values in each of those
sections and you can then when you if you open up a new document and you
still have your saved one you doc project you can say insert all formula
sections book.\
You can even later on. You can even build up a library of of of that\'s
you see. That\'s a good idea. Yeah. Reusable. Yeah, yeah.\
Let\'s, let\'s, let\'s, let\'s nail the, let\'s nail the the UI. The UI
to me is important. Exactly, exactly. Yeah, let\'s nail that first part.
Yeah. Initialization the.\
And then it becomes. So actually before the date, yeah, the data sets
could be part, but it\'s let\'s let\'s. I mean, you don\'t want to be
honest with you, I actually think that.\
I I don\'t know how it would work if.\
I think you can only. I think it makes sense to me that.\
The view I think it would be hard to view your entire.\
I think it, I think it would be very hard to view your entire document
all at once. I think that\'s that to me seems like a very difficult, but
if you, yeah, clicked into your sections like we have.\
Yeah, you know, or is it building it?\
We have here. I think it definitely makes sense to be able to. You have
your initial setup and then when you click in here it shows your formula
and then you have view so you can view your specific section. Yeah,
because I think it gets super complicated if you\'re trying to view the
whole document all at once, you know what I mean? Or you just have a
button that says.\
Hey, make a Word document and then basically builds a Word document with
that resolves the whole thing. Yeah, I mean, you just have to, I think
it. I don\'t know how. No, no, no. But it\'s, I mean, yeah, so the focus
is on the formula sections. Yeah, those are the ones where you\'re
saying this is a building block.\
Yeah, and then it\'s. Yeah. So it\'s kinda like, you know, the for loop
comes in and then this is one. This is a formula section. Yeah, this is
a formula section. This whole thing. This is a formula section. If I
looked at this, then I would have a a doc project.\
Where I would have 1234 formula sections and if I highlight one it would
open that one. Or if I say if I highlight that one and I click edit, it
will open that formula section for me to sit and work with. Yep, I
agree. Yeah, so if I had it here.\
And then this takes me into the formula builder tab for that section.
For that section, yeah. And then I come in, then I can do view and
that\'s where I select my item that this section is related to. So like
the top level item of this section, so the configured product and then I
can go into view.\
And then then you know how you were showing on this little formula
editor here. Yeah, that\'s where it would show the. Yeah, yeah. And you
didn\'t have the data sets to be able to saying out of those 15, I only
want to work with two of them where I wanna for this specifically one
that I\'m working with right now is the one.\
With above 50% discount, so I need to be able to select that specific.
Yeah. So when I sit in my formal editor, I can see how this goes for
this specific objects, yeah.\
Good stuff. Does that all make sense? Yeah, I think it does. And I like
the iteration, right? Cuz it\'s this. I want it to be usable, right? I
don\'t wanna spend 100 hours on something that\'s not gonna be used. No,
I agree. Yeah. So right now it\'s a cool gadget, it\'s a cool toy, but I
also sense that it gives you.\
More frustration than actually. Yeah, yeah. I mean, I think there\'s
just little things with the UI like that, like the top header part.
Yeah, and then. But I do think being able to build out this stuff
dynamically and not having to. I mean, and to be honest, every time I do
Docgen, I always have to have the help center up.\
Because yeah, it\'s there\'s just so many. Yeah, exactly. Yeah,
functions and stuff like that that I always forget. I was. And then I
always have to have the you essentially need three screens because you
have to have the document up, the help center up, and then on your
bottom you have to have your you have to have the actual tech top back
end because you need to look at all your.\
Attributes to be like what are my attributes again? I was thinking if we
can recognize the document if you go to I don\'t you have tags in is it
info on the document?\
Maybe I can set something on the yeah exactly. You can have tags so I
can actually generate a doctrine unique ID that is then kept in the side
panel. So if you open that one again then you would say oh this is this
is actually this one.\
If the API supports that on the Microsoft Word, right? Yeah. But that
could be a way to correlate the two to see, hey, have I seen this
before? Yeah, I could be in a catalog. Yeah, yeah, because that\'s not
going to be intrusive for Doc Gen. itself, no.\
I wonder if I upload it, it\'ll stay. I think it does.\
Go to my. Go to one of my personal environments. Yeah, sure.\
Oh, you mean if you upload and download it? Yeah, yeah. And then so the
other thing too. So let\'s see if I go to.\
Yeah, there\'s zero doc Gen. API, so there\'s nothing. There\'s nothing.
No, you can just download the doc.\
Well, I will put this this document\'s not an object in the Object
Explorer.\
It\'s a master data, yeah, so they sits on the master data, right? So
you should be able to query at least the names and stuff like that and
then download it if you could.\
See I upload so I don\'t know how they store this they.\
And those types are actually the only one that you can use. Well, I\'m
showing everything, but those are actually the only ones. Yeah, you can
only use the configure product proposal. So even in that object
selection list that I have, you have to, I have to limit it to this.
Yeah, I mean, I would, I don\'t know anyone that\'s used, well, actually
proposal master type.\
I don\'t know, I can\'t remember but but right? Yeah, so it only
supports solution configured. Just can you open it? Yeah, solution
configured product proposal and proposal master template. Which the
proposal master template I think is just to say that this.\
Proposal has different sections. Yeah. So you basically always start
with solution, configure product and proposal. Yep. Yeah. So it should
just start those three initially have at the top and then have at the
bottom. Well, you can\'t even. Yeah. On the setup, you can\'t even
select other ones. No, it\'s those three. No. Yeah.\
Yeah, yeah, let\'s try and upload this.\
Probably generates a whole new Word document when you press. I don\'t
know, I\'m not seeing it.\
Or if not, we\'ll just add in a unique ID to the.\
To the name of the document.\
Oh, that\'s definitely a whole new document.\
Uh huh.\
Fantastic, right? It\'s this. So if I can read that from the API, then I
can actually identify that. So even though if you have in a year you\'ve
done 100 of those, every time you open that one, it will say, hey, I
actually got this already. You want to load it, yeah?\
So when it opens the document, that would work, yeah.\
So you don\'t have to kind of remember, oh, what was the doc template
that I actually used for this one? Yep.

![](media/mxblyoo2ay5bg7uayxz2-.png){width="0.22916666666666666in"
height="0.22916666666666666in"}**\
Samuel Bell** stopped transcription
